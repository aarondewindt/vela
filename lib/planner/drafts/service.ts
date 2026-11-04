import 'server-only';
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { Prisma, type PlannerDraft } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { fingerprint, loadSnapshot, type Snapshot } from '../proposals/snapshot';
import { documentSchema, type ProposalDocument } from '../proposals/schema';
import { wallInstant } from '../proposals/time';
import {
  applyDraftSchema,
  cancelDraftSchema,
  draftCommandSchema,
  draftStateSchema,
  slotDraftSchema,
  type DraftState,
} from './schema';
import {
  applyDocument,
  draftAcceptanceConflicts,
  initialState,
  inputHash,
  validateDraft,
  scheduleHash,
  withDraft,
} from './state';

const day = (date: string) => new Date(`${date}T00:00:00Z`);
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const conflict = (message = 'The draft changed in another tab. Reload it before editing.') =>
  new TRPCError({ code: 'CONFLICT', message });
const MAX_REVISIONS = 100;
type Command = z.output<typeof draftCommandSchema>;

// Same ordered table locks as legacy proposal acceptance. This also fences legacy
// writers which do not participate in owner advisory locks. Never hold over AI calls.
export async function draftTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  write = false
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        if (write) {
          await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
          await tx.$executeRaw`LOCK TABLE "user", "themes", "tasks", "task_dependencies", "task_occurrences", "availability_windows", "day_overrides", "date_availability_windows", "availability_templates", "availability_template_slots", "availability_template_revisions", "availability_template_revision_slots", "weekly_availability_assignments", "date_availability_overrides", "date_availability_slots", "planner_timezone_periods", "calendar_events", "planner_generation_settings", "daily_plans", "daily_blocks", "daily_plan_category_slots", "planning_proposals", "planner_drafts", "planner_draft_revisions", "planner_draft_requests" IN SHARE ROW EXCLUSIVE MODE`;
        }
        return operation(tx);
      },
      { isolationLevel: write ? 'ReadCommitted' : 'RepeatableRead', timeout: 15000, maxWait: 5000 }
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (['P2034', 'P2002'].includes(error.code) ||
        (error.code === 'P2010' && ['40001', '40P01', '55P03'].includes(String(error.meta?.code))))
    ) {
      throw conflict(
        'Planning data is busy or changed. Reload and retry with the same request ID.'
      );
    }
    throw error;
  }
}
async function currentState(tx: Prisma.TransactionClient, row: PlannerDraft) {
  return draftStateSchema.parse(
    (
      await tx.plannerDraftRevision.findUniqueOrThrow({
        where: { draftId_sequence: { draftId: row.id, sequence: row.cursor } },
      })
    ).state
  );
}
function assertFresh(row: PlannerDraft, s: Snapshot, state: DraftState) {
  if (row.baseHash !== inputHash(s, state)) {
    throw conflict(
      'The active schedule or relevant planning inputs changed. Your draft is saved; refresh its inputs or cancel it before starting again.'
    );
  }
}
function validateNet(
  s: Snapshot,
  base: DraftState,
  state: DraftState,
  policy: 'manual' | 'acceptance' = 'manual'
) {
  try {
    return validateDraft(s, base, state, new Date(), policy);
  } catch (error) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: error instanceof Error ? error.message : 'Invalid draft.',
    });
  }
}
async function open(
  tx: Prisma.TransactionClient,
  userId: string,
  input: Command,
  s: Snapshot,
  create: boolean
) {
  let row = await tx.plannerDraft.findFirst({
    where: { userId, planDate: day(input.date), status: 'OPEN' },
  });
  if (!row && create && input.draftId === null && input.expectedVersion === 0) {
    const base = initialState(s);
    row = await tx.plannerDraft.create({
      data: {
        userId,
        planDate: day(input.date),
        timezone: s.timezone,
        basePlanId: s.plan?.id,
        baseHash: inputHash(s, base),
        baseState: json(base),
        revisions: { create: { sequence: 0, state: json(base), label: 'Initial schedule' } },
      },
    });
    return row;
  }
  if (!row || row.id !== input.draftId || row.version !== input.expectedVersion) {
    throw conflict();
  }
  return row;
}
async function request<T extends Command>(
  userId: string,
  input: T,
  action: string,
  operation: (
    tx: Prisma.TransactionClient,
    s: Snapshot,
    row: PlannerDraft,
    state: DraftState
  ) => Promise<unknown>,
  create = false
) {
  const requestHash = fingerprint({ action, input });
  return draftTransaction(async (tx) => {
    const previous = await tx.plannerDraftRequest.findUnique({
      where: { userId_requestId: { userId, requestId: input.requestId } },
    });
    if (previous) {
      if (previous.requestHash !== requestHash) {
        throw conflict('This request ID was already used for a different draft action.');
      }
      return previous.result;
    }
    const s = await loadSnapshot(tx, userId, input.date);
    const row = await open(tx, userId, input, s, create);
    const state = await currentState(tx, row);
    const result = await operation(tx, s, row, state);
    await tx.plannerDraftRequest.create({
      data: {
        userId,
        requestId: input.requestId,
        draftId: row.id,
        requestHash,
        result: json(result),
      },
    });
    return json(result);
  }, true);
}
async function append(
  tx: Prisma.TransactionClient,
  row: PlannerDraft,
  state: DraftState,
  s: Snapshot,
  label: string
) {
  await tx.plannerDraftRevision.deleteMany({
    where: { draftId: row.id, sequence: { gt: row.cursor } },
  });
  await tx.plannerDraftRevision.create({
    data: { draftId: row.id, sequence: row.nextRevision, state: json(state), label },
  });
  const revisions = await tx.plannerDraftRevision.findMany({
    where: { draftId: row.id },
    orderBy: { sequence: 'desc' },
    select: { sequence: true },
    skip: MAX_REVISIONS,
  });
  if (revisions.length) {
    await tx.plannerDraftRevision.deleteMany({
      where: { draftId: row.id, sequence: { in: revisions.map((r) => r.sequence) } },
    });
  }
  return tx.plannerDraft.update({
    where: { id: row.id },
    data: {
      version: { increment: 1 },
      cursor: row.nextRevision,
      nextRevision: { increment: 1 },
      baseHash: inputHash(s, state),
    },
  });
}

export const draftService = {
  async slot(userId: string, raw: z.input<typeof slotDraftSchema>) {
    const input = slotDraftSchema.parse(raw);
    return request(
      userId,
      input,
      'slot',
      async (tx, s, row, state) => {
        assertFresh(row, s, state);
        const next = draftStateSchema.parse(state);
        const old = next.slots.find((slot) => slot.id === input.slotId);
        if (input.action !== 'add' && (!old || new Date(old.startsAt) < new Date())) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Choose a future category reservation.',
          });
        }
        next.slots = next.slots.filter((slot) => slot.id !== input.slotId);
        if (input.action !== 'remove') {
          if (!input.startsAt || !input.endsAt || (!old && !input.category)) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Choose category and start/end times.',
            });
          }
          next.slots.push({
            id: old?.id ?? randomUUID(),
            category: old?.category ?? input.category!,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            source: 'MANUAL',
          });
        }
        validateNet(s, draftStateSchema.parse(row.baseState), next, 'manual');
        const updated = await append(tx, row, next, s, 'Edit category reservation');
        return { draftId: row.id, version: updated.version };
      },
      true
    );
  },
  async applyGenerated(
    userId: string,
    raw: Command,
    document: ProposalDocument,
    generationInputHash: string
  ) {
    const command = draftCommandSchema.parse(raw);
    const hasChanges =
      document.operations.length ||
      document.reservations?.length ||
      document.freeIntervals?.length ||
      document.taskLimits?.length;
    const parsed = hasChanges ? documentSchema.parse(document) : document;
    return request(
      userId,
      { ...command, document: parsed, generationInputHash },
      'generate',
      async (tx, s, row, state) => {
        assertFresh(row, s, state);
        if (s.plan && ['FINALIZED', 'ARCHIVED'].includes(s.plan.status)) {
          throw conflict('This day is finalized.');
        }
        let next;
        try {
          next = applyDocument(s, state, parsed, 'ai');
        } catch (error) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error instanceof Error ? error.message : 'Invalid generated draft.',
          });
        }
        validateNet(s, draftStateSchema.parse(row.baseState), next, 'manual');
        const updated = await append(tx, row, next, s, 'Generate schedule');
        return { draftId: row.id, version: updated.version, generationInputHash };
      }
    );
  },
  async byRequest(userId: string, requestId: string) {
    return prisma.plannerDraftRequest.findUnique({
      where: { userId_requestId: { userId, requestId } },
    });
  },
  async read(userId: string, date: string) {
    return draftTransaction(async (tx) => {
      const s = await loadSnapshot(tx, userId, date);
      const row = await tx.plannerDraft.findFirst({
        where: { userId, planDate: day(date), status: 'OPEN' },
      });
      if (!row) {
        return { draft: null, activePlanId: s.plan?.id ?? null };
      }
      const state = await currentState(tx, row);
      const base = draftStateSchema.parse(row.baseState);
      const revisions = await tx.plannerDraftRevision.findMany({
        where: { draftId: row.id },
        orderBy: { sequence: 'asc' },
        select: { sequence: true, label: true, createdAt: true },
      });
      const conflicts: string[] = [];
      if (row.baseHash !== inputHash(s, state)) {
        conflicts.push('The active schedule or relevant planning inputs changed.');
      }
      conflicts.push(...draftAcceptanceConflicts(s, state));
      return {
        activePlanId: s.plan?.id ?? null,
        draft: {
          id: row.id,
          date,
          timezone: row.timezone,
          version: row.version,
          state,
          modified: scheduleHash(base) !== scheduleHash(state),
          conflicts,
          canUndo: revisions.some((r) => r.sequence < row.cursor),
          canRedo: revisions.some((r) => r.sequence > row.cursor),
          revisions,
          cursor: row.cursor,
        },
      };
    });
  },
  async begin(userId: string, raw: z.input<typeof draftCommandSchema>) {
    const input = draftCommandSchema.parse(raw);
    return request(
      userId,
      input,
      'begin',
      async (_tx, _s, row) => ({ draftId: row.id, version: row.version }),
      true
    );
  },
  async apply(userId: string, raw: z.input<typeof applyDraftSchema>) {
    const input = applyDraftSchema.parse(raw);
    return request(
      userId,
      input,
      'apply',
      async (tx, s, row, state) => {
        assertFresh(row, s, state);
        if (s.plan && ['FINALIZED', 'ARCHIVED'].includes(s.plan.status)) {
          throw conflict('This day is finalized.');
        }
        let next;
        try {
          next = applyDocument(
            s,
            state,
            input.document,
            input.origin,
            new Date(),
            input.preserveIntent
          );
        } catch (error) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error instanceof Error ? error.message : 'Invalid draft edit.',
          });
        }
        validateNet(s, draftStateSchema.parse(row.baseState), next, 'manual');
        const updated = await append(tx, row, next, s, input.label);
        return { draftId: row.id, version: updated.version };
      },
      true
    );
  },
  async history(
    userId: string,
    raw: z.input<typeof draftCommandSchema>,
    direction: 'undo' | 'redo'
  ) {
    const input = draftCommandSchema.parse(raw);
    return request(userId, input, direction, async (tx, s, row, state) => {
      assertFresh(row, s, state);
      const target = await tx.plannerDraftRevision.findFirst({
        where: {
          draftId: row.id,
          sequence: direction === 'undo' ? { lt: row.cursor } : { gt: row.cursor },
        },
        orderBy: { sequence: direction === 'undo' ? 'desc' : 'asc' },
      });
      if (!target) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Nothing to ${direction}.` });
      }
      const next = draftStateSchema.parse(target.state);
      const updated = await tx.plannerDraft.update({
        where: { id: row.id },
        data: { cursor: target.sequence, version: { increment: 1 }, baseHash: inputHash(s, next) },
      });
      return { draftId: row.id, version: updated.version };
    });
  },
  async cancel(userId: string, raw: z.input<typeof cancelDraftSchema>) {
    const input = cancelDraftSchema.parse(raw);
    return request(userId, input, 'cancel', async (tx, _s, row, state) => {
      if (
        !input.confirmed &&
        scheduleHash(state) !== scheduleHash(draftStateSchema.parse(row.baseState))
      ) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Confirm cancellation of this modified draft.',
        });
      }
      await tx.plannerDraft.update({
        where: { id: row.id },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      return { cancelled: true, draftId: row.id };
    });
  },
  // Explicit refresh is conservative: only refresh inputs when the active base is
  // unchanged and the complete draft still passes current deterministic validation.
  async refresh(userId: string, raw: z.input<typeof draftCommandSchema>) {
    const input = draftCommandSchema.parse(raw);
    return request(userId, input, 'refresh', async (tx, s, row, state) => {
      if (
        s.timezone !== row.timezone ||
        s.user.timezone !== row.timezone ||
        s.plan?.id !== (row.basePlanId ?? undefined) ||
        scheduleHash(initialState(s)) !== scheduleHash(draftStateSchema.parse(row.baseState))
      ) {
        throw conflict(
          'The active schedule changed. Keep this saved draft for comparison, or cancel it and start from the new active schedule.'
        );
      }
      validateNet(s, draftStateSchema.parse(row.baseState), state, 'manual');
      const updated = await tx.plannerDraft.update({
        where: { id: row.id },
        data: { baseHash: inputHash(s, state), version: { increment: 1 } },
      });
      return { draftId: row.id, version: updated.version };
    });
  },
  async accept(userId: string, raw: z.input<typeof draftCommandSchema>) {
    const input = draftCommandSchema.parse(raw);
    return request(userId, input, 'accept', async (tx, s, row, state) => {
      assertFresh(row, s, state);
      if (s.plan && ['FINALIZED', 'ARCHIVED'].includes(s.plan.status)) {
        throw conflict('This day is finalized.');
      }
      if (wallInstant(input.date, 1440, row.timezone) <= new Date()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Past-day drafts remain saved and cannot be activated.',
        });
      }
      validateNet(s, draftStateSchema.parse(row.baseState), state, 'acceptance');
      await tx.dailyPlan.updateMany({
        where: { userId, planDate: row.planDate, isCurrent: true },
        data: { isCurrent: false },
      });
      const plan = await tx.dailyPlan.create({
        data: {
          userId,
          planDate: row.planDate,
          timezone: row.timezone,
          status: 'ACTIVE',
          isCurrent: true,
          version: (s.plans.at(-1)?.version ?? 0) + 1,
          generatedBy: 'MANUAL',
          explanationJson: json({
            draftId: row.id,
            draftVersion: row.version,
            generation: state.generation,
          }),
        },
      });
      const occurrenceIds = new Map<string, string>();
      const blockIds: Record<string, string> = {};
      for (const block of state.blocks) {
        let occurrenceId = block.occurrenceId;
        if (block.taskId && !occurrenceId) {
          occurrenceId = occurrenceIds.get(block.taskId) ?? null;
          if (!occurrenceId) {
            const occurrence = await tx.taskOccurrence.create({
              data: {
                userId,
                taskId: block.taskId,
                occurrenceDate: row.planDate,
                origin: s.tasks.find((t) => t.id === block.taskId)?.isRecurring
                  ? 'RECURRENCE'
                  : 'MANUAL',
                status: 'SCHEDULED',
              },
            });
            occurrenceId = occurrence.id;
            occurrenceIds.set(block.taskId, occurrenceId);
          }
        }
        const original = s.blocks.find((b) => b.id === block.id && b.planId === s.plan?.id);
        const created = await tx.dailyBlock.create({
          data: {
            id: randomUUID(),
            userId,
            planId: plan.id,
            taskOccurrenceId: occurrenceId,
            calendarEventId: block.calendarEventId,
            title: block.title,
            category: block.category,
            mealKind: block.mealKind,
            startsAt: new Date(block.startsAt),
            endsAt: new Date(block.endsAt),
            durationMinutes: block.durationMinutes,
            source: block.source,
            status: block.status,
            isFixed: block.isFixed,
            manualOverride: block.manualOverride,
            isLocked: block.isLocked,
            brief: original?.brief,
            content:
              original?.content === null || !original
                ? Prisma.DbNull
                : (original.content as Prisma.InputJsonValue),
            position: original?.position,
            completedAt: original?.completedAt,
          },
        });
        blockIds[block.id] = created.id;
      }
      if (state.slots.length) {
        await tx.dailyPlanCategorySlot.createMany({
          data: state.slots.map((slot) => ({
            ...slot,
            id: randomUUID(),
            planId: plan.id,
            startsAt: new Date(slot.startsAt),
            endsAt: new Date(slot.endsAt),
          })),
        });
      }
      // Scheduling existing work never changes its outcome or task progress. Only
      // new occurrences are materialized above; all existing occurrences are reused.
      const receipt = { draftId: row.id, planId: plan.id, version: plan.version, blockIds };
      await tx.plannerDraft.update({
        where: { id: row.id },
        data: { status: 'ACCEPTED', version: { increment: 1 }, receipt: json(receipt) },
      });
      return receipt;
    });
  },
  async snapshot(userId: string, date: string, allowStale = false) {
    return draftTransaction(async (tx) => {
      const s = await loadSnapshot(tx, userId, date);
      const row = await tx.plannerDraft.findFirst({
        where: { userId, planDate: day(date), status: 'OPEN' },
      });
      if (!row) {
        return { snapshot: s, draft: null };
      }
      const state = await currentState(tx, row);
      if (!allowStale) {
        assertFresh(row, s, state);
      }
      return {
        snapshot: withDraft(s, state),
        draft: { id: row.id, version: row.version, stale: row.baseHash !== inputHash(s, state) },
      };
    });
  },
};

export async function mutateDraft<T extends Command>(
  userId: string,
  input: T,
  action: string,
  build: (s: Snapshot) => ProposalDocument
) {
  return request(
    userId,
    input,
    action,
    async (tx, s, row, state) => {
      assertFresh(row, s, state);
      if (s.plan && ['FINALIZED', 'ARCHIVED'].includes(s.plan.status)) {
        throw conflict('This day is finalized.');
      }
      let next;
      try {
        next = applyDocument(s, state, documentSchema.parse(build(withDraft(s, state))), 'manual');
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Invalid draft edit.',
        });
      }
      validateNet(s, draftStateSchema.parse(row.baseState), next, 'manual');
      const updated = await append(tx, row, next, s, 'Manual calendar edit');
      return { draftId: row.id, version: updated.version };
    },
    true
  );
}
