import 'server-only';

import { workspaceRecords } from './records';
import { dateInTimezone } from '@/lib/nutrition/dates';
import { createHash } from 'node:crypto';
import { tool } from 'ai';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { AiError } from '@/lib/ai/errors';
import { generateDaySchema } from '../generation/schema';
import { generateWorkingDraft } from '../drafts/generation';
import { draftInstruction, draftInstructions } from '../drafts/planning';
import { draftService } from '../drafts/service';
import { Clarification, relativeDueDate } from '../conversation/resolve';
import { instructionSchema, replaceBlocksSchema } from '../conversation/schema';
import { proposalService } from '../proposals/service';
import { reviewDayPlan } from '../review/service';
import { reviewDaySchema } from '../review/schema';
import { plannerChatContext } from './context';

const recordToolSchema = instructionSchema.options[2]
  .omit({ type: true })
  .partial({ query: true, task: true, theme: true });
const dateSchema = z.object({ date: z.iso.date() }).strict();
const actionSchema = z.discriminatedUnion('type', [
  instructionSchema.options[6].extend({
    blockQuery: instructionSchema.options[6].shape.blockQuery.default(null),
    candidateQuery: instructionSchema.options[6].shape.candidateQuery.default(null),
    startTime: instructionSchema.options[6].shape.startTime.default(null),
    endTime: instructionSchema.options[6].shape.endTime.default(null),
  }),
  instructionSchema.options[5].extend({
    action: z.enum(['replan', 'postpone', 'cancel', 'replace']),
    blockQuery: instructionSchema.options[5].shape.blockQuery.default(null),
    candidateQuery: instructionSchema.options[5].shape.candidateQuery.default(null),
    startTime: instructionSchema.options[5].shape.startTime.default(null),
    endTime: instructionSchema.options[5].shape.endTime.default(null),
    additionalMinutes: z.null().default(null),
    completeTask: z.literal(false).default(false),
  }),
  instructionSchema.options[7],
  instructionSchema.options[8],
]);

export function planningGuidance(latestRequest: string | undefined, context: string) {
  const latest = latestRequest?.trim();
  if (!latest || latest === context.trim()) {
    return latest || context;
  }
  const suffix = `\n\nPlanning context: ${context}`;
  const remaining = 2000 - latest.length;
  return latest + (remaining > 24 ? suffix.slice(0, remaining) : '');
}

// The conversation owns references; models cannot supply a foreign proposal ID or approve it.
export function planningTools(
  userId: string,
  turnKey: string,
  _pending?: { date: string; proposalId: string },
  userTimezone?: string,
  latestRequest?: string,
  conversationId?: string,
  workspaceDate?: string
) {
  let queue = Promise.resolve();
  let modified = false;
  const sequential = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation);
    queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };
  const requestId = (operation: unknown) => {
    const hash = createHash('sha256')
      .update(JSON.stringify([userId, turnKey, operation]))
      .digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  };
  const result = (date: string, reply: string) => ({ date, reply: reply.slice(0, 16000) });
  const generationReply = (value: unknown) => {
    if (value && typeof value === 'object' && 'unchanged' in value && value.unchanged) {
      return 'summary' in value && typeof value.summary === 'string'
        ? value.summary
        : 'No draft changes were needed.';
    }
    return 'Draft schedule updated.';
  };
  const failure = (date: string, error: unknown) => ({
    ...result(
      date,
      error instanceof TRPCError || error instanceof AiError
        ? `Could not update the draft: ${error.message}`
        : 'Could not update the draft. Retry when the planning service is available.'
    ),
    draftFailed: true,
  });
  const executeAction = (instruction: z.input<typeof actionSchema>) =>
    sequential(async () => {
      const parsed = actionSchema.parse(instruction);
      if (
        parsed.type !== 'edit' &&
        parsed.type !== 'reserve' &&
        parsed.type !== 'replan' &&
        parsed.type !== 'replaceBlocks'
      ) {
        throw new Error('Unsupported planning action.');
      }
      if (modified) {
        return result(
          parsed.date,
          'This instruction already updated the draft. Summarize the saved change.'
        );
      }
      try {
        const updated = await draftInstruction(userId, requestId(parsed), parsed, userTimezone);
        modified = true;
        return updated;
      } catch (error) {
        if (error instanceof Clarification) {
          return result(parsed.date, error.message);
        }
        return failure(parsed.date, error);
      }
    });
  const executeRecord = async (input: z.output<typeof recordToolSchema>, revise = false) =>
    sequential(async () => {
      if (!conversationId || !workspaceDate) {
        throw new Error('Workspace conversation required.');
      }
      const instruction = {
        ...input,
        type: 'record' as const,
        query: input.query ?? null,
        task: input.task ?? null,
        theme: input.theme ?? null,
      };
      const due = relativeDueDate(
        latestRequest ?? '',
        dateInTimezone(userTimezone ?? 'Europe/Amsterdam'),
        instruction.task?.title
      );
      if (due && instruction.entity === 'task' && instruction.action !== 'delete') {
        instruction.task = { ...instruction.task, dueDate: due };
      }
      try {
        const preview = await workspaceRecords.propose(
          userId,
          conversationId,
          requestId({ type: 'record' }),
          instruction,
          turnKey.slice(conversationId.length + 1),
          revise
        );
        return {
          date: workspaceDate,
          recordProposalId: preview.id,
          reply: `A ${preview.preview.entity} ${preview.preview.action} preview is ready. Nothing has been applied. Use Accept changes in the card; deletion requires the confirmation checkbox and Confirm deletion.`,
          record: preview.preview,
        };
      } catch (error) {
        if (error instanceof Clarification) {
          return { date: workspaceDate, reply: error.message, matches: error.matches };
        }
        throw error;
      }
    });
  return {
    editScheduleBatch: tool({
      description:
        'Apply several explicit schedule edits in ONE atomic undoable draft revision. Use this instead of separate mutation calls for a multi-part user instruction. All actions must target the same date. Generation uses generateDayPlan instead.',
      inputSchema: z.object({ actions: z.array(actionSchema).min(1).max(20) }).strict(),
      execute: ({ actions }) =>
        sequential(async () => {
          const parsed = actions as Parameters<typeof draftInstructions>[2];
          if (modified) {
            return result(parsed[0].date, 'This instruction already updated the draft.');
          }
          try {
            const updated = await draftInstructions(
              userId,
              requestId(parsed),
              parsed,
              userTimezone
            );
            modified = true;
            return updated;
          } catch (error) {
            return error instanceof Clarification
              ? result(parsed[0].date, error.message)
              : failure(parsed[0].date, error);
          }
        }),
    }),
    findPlannerRecords: tool({
      description:
        'Find owner tasks or themes by exact name/ID or substring, including unscheduled and completed records. Show ambiguous choices with IDs; never guess. Use before updating/deleting or assigning a theme.',
      inputSchema: instructionSchema.options[1].omit({ type: true }),
      execute: async ({ entity, query }) =>
        sequential(async () => {
          if (!conversationId || !workspaceDate) {
            throw new Error('Workspace conversation required.');
          }
          return {
            date: workspaceDate,
            ...(await workspaceRecords.find(userId, conversationId, entity, query)),
          };
        }),
    }),
    proposeRecordChange: tool({
      description:
        'Preview ONE task/theme create, update or delete. Missing fields retain current values; null clears nullable fields. Task themeQuery accepts exact theme name/ID or null to clear. Use reviseRecordChange to correct an existing pending preview. Deletes need explicit confirmation in the card. Unsupported recurrence, dependencies, locations or rich notes need the regular editor.',
      inputSchema: recordToolSchema,
      execute: (input) => executeRecord(input),
    }),
    reviseRecordChange: tool({
      description:
        'Correct the single pending task/theme preview, including a task that has not been created yet. Use for “make that 60 minutes instead” and other follow-up corrections. The application retains the original action, target and prior fields. Supply only changed task or theme fields. Never use update on an unaccepted creation.',
      inputSchema: recordToolSchema.pick({ task: true, theme: true }),
      execute: (input) => executeRecord({ ...input, entity: 'task', action: 'update' }, true),
    }),
    getPlanningContext: tool({
      description:
        'Retrieve bounded authorized tasks, blocks and availability for a date. Use to resolve references; ask if ambiguous.',
      inputSchema: dateSchema,
      execute: async ({ date }) => plannerChatContext(userId, date),
    }),
    generateDayPlan: tool({
      description:
        'Invoke the existing AI scheduler using saved availability and the current-time cutoff. Pass the user’s requests, constraints, hints, durations, preferred order and priorities as guidance, preserving relevant conversation context. The scheduler interprets and places tasks; do not classify requirements as unsupported or demand exact time slots before calling it. Edits the persistent working draft, never the active schedule. Set rebuild only for an explicit request to completely rebuild eligible future placements.',
      inputSchema: generateDaySchema
        .pick({ date: true, guidance: true })
        .extend({ rebuild: z.boolean().optional() }),
      execute: async ({ date, guidance, rebuild }) =>
        sequential(async () => {
          if (modified) {
            return result(date, 'This instruction already updated the draft.');
          }
          const schedulerGuidance = planningGuidance(latestRequest, guidance);
          const id = requestId({
            type: 'generate',
            date,
            guidance: schedulerGuidance,
            rebuild: Boolean(rebuild),
          });
          const saved = await draftService.byRequest(userId, id);
          if (saved) {
            return { ...result(date, generationReply(saved.result)), draftUpdated: true };
          }
          try {
            const { draft } = await draftService.read(userId, date);
            const generated = await generateWorkingDraft(userId, {
              requestId: id,
              date,
              draftId: draft?.id ?? null,
              expectedVersion: draft?.version ?? 0,
              mode: 'ai',
              guidance: schedulerGuidance,
              rebuild: Boolean(rebuild),
            });
            modified = true;
            return { ...result(date, generationReply(generated)), draftUpdated: true };
          } catch (error) {
            return failure(date, error);
          }
        }),
    }),
    proposeScheduleChanges: tool({
      description:
        'Propose a specific edit, timed free interval, or progress/replanning action via existing services. References must identify exactly one task/block. Edits update the persistent draft; active stays unchanged. Actual task progress is recorded separately. For easier replacements ask which eligible task. Never complete tasks unless explicitly requested.',
      inputSchema: actionSchema,
      execute: executeAction,
    }),
    replaceScheduledBlocks: tool({
      description:
        'Replace one or several specific planned blocks with an eligible task, preserving every selected block’s exact times and all unrelated preview changes. For requests such as replace Vela blocks after 20:30, select the matching block IDs from draft context using its local timezone. Pass the exact eligible candidate ID. Never invent time slots. Edits the working draft in one undoable batch; active stays unchanged.',
      inputSchema: replaceBlocksSchema.omit({ type: true }),
      execute: async (input) => executeAction({ ...input, type: 'replaceBlocks' }),
    }),
    reviewDayPlan: tool({
      description:
        'Review current or pending plan using the existing review service. Deterministic conflicts and optional AI concerns remain distinct.',
      inputSchema: reviewDaySchema.omit({ proposalId: true, selection: true }),
      execute: async (input) =>
        sequential(async () => {
          const { snapshot } = await draftService.snapshot(userId, input.date, true);
          const review = await reviewDayPlan(
            userId,
            {
              ...input,
            },
            snapshot
          );
          const compact = {
            ...review,
            guidance: review.guidance.slice(0, 500),
            conflicts: review.conflicts.slice(0, 16),
            concerns: review.concerns.slice(0, 8),
            corrections: review.corrections.slice(0, 4),
            blocks: review.blocks.slice(0, 40),
            warnings: review.warnings.slice(0, 8).map((warning) => warning.slice(0, 400)),
            aiError: review.aiError?.slice(0, 1000) ?? null,
          };
          // Correction documents can be large. Keep the card bounded and offer a fresh full review.
          while (JSON.stringify(compact).length > 12000) {
            if (compact.corrections.length) {
              compact.corrections.pop();
            } else if (compact.blocks.length) {
              compact.blocks.pop();
            } else if (compact.conflicts.length) {
              compact.conflicts.pop();
            } else if (compact.concerns.length) {
              compact.concerns.pop();
            } else {
              break;
            }
          }
          const omitted =
            review.conflicts.length -
            compact.conflicts.length +
            review.concerns.length -
            compact.concerns.length +
            review.corrections.length -
            compact.corrections.length;
          return {
            ...result(
              input.date,
              `Schedule review: ${review.conflicts.length} verified conflicts, ${review.concerns.length} advisory concerns.${omitted ? ' Some findings or correction options omitted from this compact card; run Review day plan for all details.' : ''}`
            ),
            review: compact,
          };
        }),
    }),
    explainPlanningDecision: tool({
      description:
        'Read saved proposal explanations and omissions without running the scheduler or another model.',
      inputSchema: dateSchema,
      execute: async ({ date }) =>
        sequential(async () => {
          const { draft } = await draftService.read(userId, date);
          if (draft) {
            return result(
              date,
              draft.state.generation
                ? [
                    draft.state.generation.summary,
                    ...draft.state.generation.outcomes.map((o) => `${o.title}: ${o.reason}`),
                  ].join('\n')
                : `Working draft: ${draft.state.blocks.length} blocks. ${draft.conflicts.join(' ') || 'Changes remain in the draft until you use Accept.'}`
            );
          }
          const applied = (await proposalService.list(userId, date)).find(
            (p) => p.status === 'APPLIED'
          );
          const proposal = applied ? await proposalService.get(userId, applied.id) : null;
          return result(
            date,
            proposal?.preview.generation?.summary ??
              'No saved planning explanation is available for this date.'
          );
        }),
    }),
  };
}
