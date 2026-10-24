import 'server-only';

import { createHash } from 'node:crypto';
import { tool } from 'ai';
import { z } from 'zod';
import { generateDaySchema } from '../generation/schema';
import { generateDayPlan } from '../generation/service';
import { planInstruction } from '../conversation/planning';
import { Clarification } from '../conversation/resolve';
import { instructionSchema } from '../conversation/schema';
import { proposalService } from '../proposals/service';
import { reviewDayPlan } from '../review/service';
import { reviewDaySchema } from '../review/schema';
import { plannerChatContext } from './context';

const dateSchema = z.object({ date: z.iso.date() }).strict();
const actionSchema = z.union(
  instructionSchema.options.filter((option) =>
    ['edit', 'reserve', 'replan'].includes(option.shape.type.value)
  )
);

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
  pending?: { date: string; proposalId: string },
  userTimezone?: string,
  latestRequest?: string
) {
  let current = pending;
  let queue = Promise.resolve();
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
  const replay = async (id: string) => proposalService.byRequest(userId, id);
  const result = (date: string, reply: string, proposalId?: string) => {
    if (proposalId) {
      current = { date, proposalId };
    }
    return { date, reply: reply.slice(0, 16000), ...(proposalId ? { proposalId } : {}) };
  };
  const checkPending = async (date: string) => {
    if (!current || current.date !== date) {
      return undefined;
    }
    const proposal = await proposalService.get(userId, current.proposalId);
    if (proposal.status !== 'PENDING') {
      return undefined;
    }
    if (proposal.invalidReason) {
      throw new Clarification(proposal.invalidReason);
    }
    return current;
  };
  return {
    getPlanningContext: tool({
      description:
        'Retrieve bounded authorized tasks, blocks and availability for a date. Use to resolve references; ask if ambiguous.',
      inputSchema: dateSchema,
      execute: async ({ date }) => plannerChatContext(userId, date),
    }),
    generateDayPlan: tool({
      description:
        'Invoke the existing AI scheduler using saved availability and the current-time cutoff. Pass the user’s requests, constraints, hints, durations, preferred order and priorities as guidance, preserving relevant conversation context. The scheduler interprets and places tasks; do not classify requirements as unsupported or demand exact time slots before calling it. Returns a validated pending preview, never applies changes.',
      inputSchema: generateDaySchema.pick({ date: true, guidance: true }),
      execute: async ({ date, guidance }) =>
        sequential(async () => {
          const schedulerGuidance = planningGuidance(latestRequest, guidance);
          const id = requestId({ type: 'generate', date, guidance: schedulerGuidance });
          const saved = await replay(id);
          if (saved) {
            return result(date, 'Recovered the saved proposal. Review before accepting.', saved.id);
          }
          const old = await checkPending(date);
          const generated = await generateDayPlan(userId, {
            requestId: id,
            date,
            mode: 'ai',
            guidance: schedulerGuidance,
            reviseProposalId: old?.proposalId,
          });
          if (old && generated.id && old.proposalId !== generated.id) {
            await proposalService.discard(userId, old.proposalId);
          }
          return result(date, generated.report.summary, generated.id ?? undefined);
        }),
    }),
    proposeScheduleChanges: tool({
      description:
        'Propose a specific edit, timed free interval, or progress/replanning action via existing services. References must identify exactly one task/block. Revisions compose with the pending preview; nothing is applied. For easier replacements ask which eligible task. Never complete tasks unless explicitly requested.',
      inputSchema: actionSchema,
      execute: async (instruction) =>
        sequential(async () => {
          const parsed = actionSchema.parse(instruction);
          if (parsed.type !== 'edit' && parsed.type !== 'reserve' && parsed.type !== 'replan') {
            throw new Error('Unsupported planning action.');
          }
          try {
            const id = requestId(parsed);
            const saved = await replay(id);
            if (saved) {
              return result(
                parsed.date,
                'Recovered the saved proposal. Review before accepting.',
                saved.id
              );
            }
            const previous = await checkPending(parsed.date);
            const planned = await planInstruction(userId, id, parsed, previous, userTimezone);
            if (previous && planned.proposalId && previous.proposalId !== planned.proposalId) {
              await proposalService.discard(userId, previous.proposalId);
            }
            return result(parsed.date, planned.reply, planned.proposalId);
          } catch (error) {
            if (error instanceof Clarification) {
              return result(parsed.date, error.message);
            }
            throw error;
          }
        }),
    }),
    reviewDayPlan: tool({
      description:
        'Review current or pending plan using the existing review service. Deterministic conflicts and optional AI concerns remain distinct.',
      inputSchema: reviewDaySchema.omit({ proposalId: true }),
      execute: async (input) =>
        sequential(async () => {
          const previous = await checkPending(input.date);
          const review = await reviewDayPlan(userId, {
            ...input,
            proposalId: previous?.proposalId,
          });
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
          let proposal =
            current?.date === date ? await proposalService.get(userId, current.proposalId) : null;
          if (!proposal || !['PENDING', 'APPLIED'].includes(proposal.status)) {
            const applied = (await proposalService.list(userId, date)).find(
              (p) => p.status === 'APPLIED'
            );
            proposal = applied ? await proposalService.get(userId, applied.id) : null;
          }
          if (!proposal) {
            return result(date, 'No saved planning explanation is available for this date.');
          }
          if (proposal.invalidReason) {
            return result(date, proposal.invalidReason);
          }
          const generation = proposal.preview.generation;
          return result(
            date,
            [
              generation?.summary,
              proposal.preview.selectionExplanation
                ? `Original selection assessment: ${proposal.preview.selectionExplanation.summary}`
                : undefined,
              ...(proposal.preview.selectionExplanation?.reasons.map(
                (reason) => `${reason.title}: ${reason.reason}`
              ) ?? []),
              ...proposal.preview.changes.map((c) => c.explanation),
              ...(generation?.outcomes.map(
                (o) =>
                  `${o.title}: ${o.scheduledMinutes} minutes scheduled. ${o.reason} ${o.selectionReason ?? ''}`
              ) ?? []),
            ]
              .filter(Boolean)
              .join('\n')
          );
        }),
    }),
  };
}
