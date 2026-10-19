import 'server-only';
import { TRPCError } from '@trpc/server';
import { Prisma } from '../../../generated/prisma/client';
import { prisma } from '@/lib/prisma';
import {
  createProposalSchema,
  documentSchema,
  editSchema,
  previewSchema,
  receiptSchema,
  type Addition,
} from './schema';
import { existingBlocks, eligible, validateProposal, type ProposalBlock } from './validate';
import { fingerprint, loadSnapshot, type Snapshot } from './snapshot';
import { timeMinute, wallInstant } from './time';
import { z } from 'zod';

const day = (date: string) => new Date(`${date}T00:00:00Z`);
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const notFound = () =>
  new TRPCError({ code: 'NOT_FOUND', message: 'Planning proposal not found.' });
const stale = () =>
  new TRPCError({
    code: 'CONFLICT',
    message: 'Planning inputs changed. Create a fresh proposal and review it again.',
  });
const blockPreview = (b: ProposalBlock | null) =>
  b
    ? {
        id: b.id,
        title: b.title,
        startsAt: b.startsAt.toISOString(),
        endsAt: b.endsAt.toISOString(),
        durationMinutes: b.durationMinutes,
      }
    : null;
function previewOf(result: ReturnType<typeof validateProposal>) {
  return {
    changes: result.changes.map((c) => ({
      type: c.type,
      explanation: c.explanation,
      before: blockPreview(c.before),
      after: blockPreview(c.after),
    })),
    warnings: result.warnings,
    remaining: result.remaining,
    reservations: result.reservations.map((r) => ({
      ...r,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
    })),
  };
}

async function database<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  lock = false
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        if (lock) {
          // Legacy writers do not take an owner advisory lock. Table locks cover their
          // inserts as well as edits; keep this transaction short and model-free.
          await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
          await tx.$executeRaw`LOCK TABLE "user", "themes", "tasks", "task_dependencies", "task_occurrences", "availability_windows", "day_overrides", "date_availability_windows", "calendar_events", "planner_generation_settings", "daily_plans", "daily_blocks", "daily_plan_category_slots", "planning_proposals" IN SHARE ROW EXCLUSIVE MODE`;
        }
        return operation(tx);
      },
      { isolationLevel: lock ? 'ReadCommitted' : 'RepeatableRead', maxWait: 5000, timeout: 15000 }
    );
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (
        ['P2034', 'P2002'].includes(error.code) ||
        (error.code === 'P2010' && ['40001', '40P01', '55P03'].includes(String(error.meta?.code)))
      ) {
        throw stale();
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not save planning changes. Please retry.',
      });
    }
    if (error instanceof z.ZodError) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid planning proposal.',
        cause: error,
      });
    }
    throw error;
  }
}
function validate(s: Snapshot, document: z.infer<typeof documentSchema>) {
  try {
    return validateProposal(s, document);
  } catch (error) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: error instanceof Error ? error.message : 'Invalid planning proposal.',
    });
  }
}

export const proposalService = {
  async context(userId: string, date: string) {
    return database(async (tx) => {
      const s = await loadSnapshot(tx, userId, date);
      const candidates = s.tasks.flatMap((task) => {
        const occurrences = s.occurrences.filter(
          (o) =>
            o.taskId === task.id &&
            ['PENDING', 'SCHEDULED'].includes(o.status) &&
            o.occurrenceDate <= day(date)
        );
        const choices = occurrences.length ? occurrences.map((o) => o.id) : [null];
        return choices.flatMap((occurrenceId) => {
          try {
            eligible(s, task.id, occurrenceId);
            return [
              {
                id: `${task.id}:${occurrenceId ?? 'new'}`,
                taskId: task.id,
                occurrenceId,
                title: `${task.title}${
                  occurrenceId
                    ? ` (${s.occurrences
                        .find((o) => o.id === occurrenceId)!
                        .occurrenceDate.toISOString()
                        .slice(0, 10)})`
                    : ''
                }`,
              },
            ];
          } catch {
            // Eligibility rejection intentionally removes a candidate; no IO/model calls here.
            return [];
          }
        });
      });
      return {
        baseHash: s.hash,
        timezone: s.timezone,
        candidates,
        blocks: existingBlocks(s).map((b) => ({
          ...blockPreview(b)!,
          editable:
            b.status === 'PLANNED' &&
            !b.isFixed &&
            b.source !== 'MANUAL' &&
            !b.calendarEventId &&
            b.startsAt >= new Date(),
        })),
      };
    });
  },
  async create(userId: string, raw: z.input<typeof createProposalSchema>) {
    const input = createProposalSchema.parse(raw);
    const requestHash = fingerprint(input);
    return database(async (tx) => {
      const existing = await tx.planningProposal.findUnique({
        where: { userId_requestId: { userId, requestId: input.requestId } },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This request ID was already used for a different proposal.',
          });
        }
        return { id: existing.id };
      }
      const s = await loadSnapshot(tx, userId, input.date);
      if (s.hash !== input.baseHash) {
        throw stale();
      }
      const result = validate(s, input.document);
      const proposal = await tx.planningProposal.create({
        data: {
          userId,
          requestId: input.requestId,
          requestHash,
          planDate: day(input.date),
          timezone: s.timezone,
          baseHash: s.hash,
          document: json(input.document),
          preview: json({ ...previewOf(result), generation: input.document.generation }),
        },
      });
      return { id: proposal.id };
    });
  },
  async createEdit(userId: string, raw: z.input<typeof editSchema>) {
    const input = editSchema.parse(raw);
    const context = await this.context(userId, input.date);
    if (context.baseHash !== input.baseHash) {
      throw stale();
    }
    const explanation = input.explanation;
    if (input.type === 'remove') {
      if (!input.blockId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a block.' });
      }
      return this.create(userId, {
        requestId: input.requestId,
        date: input.date,
        baseHash: input.baseHash,
        document: {
          schemaVersion: 1,
          operations: [{ type: 'remove', blockId: input.blockId, explanation }],
        },
      });
    }
    if (!input.startTime || !input.endTime) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose start and end times.' });
    }
    let startsAt: string;
    let endsAt: string;
    try {
      startsAt = wallInstant(
        input.date,
        timeMinute(input.startTime),
        context.timezone
      ).toISOString();
      endsAt = wallInstant(input.date, timeMinute(input.endTime), context.timezone).toISOString();
    } catch (error) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: (error as Error).message });
    }
    let operation: z.infer<typeof documentSchema>['operations'][number];
    if (input.type === 'move' || input.type === 'resize') {
      if (!input.blockId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a block.' });
      }
      operation = { type: input.type, blockId: input.blockId, startsAt, endsAt, explanation };
    } else {
      const candidate = context.candidates.find((c) => c.id === input.candidateId);
      if (input.kind === 'TASK' && !candidate) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose an eligible task.' });
      }
      const block: Addition =
        input.kind === 'REST'
          ? { kind: 'REST', startsAt, endsAt }
          : {
              kind: 'TASK',
              taskId: candidate!.taskId,
              occurrenceId: candidate!.occurrenceId,
              startsAt,
              endsAt,
            };
      if (input.type === 'replace') {
        if (!input.blockId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a block.' });
        }
        operation = { type: 'replace', blockId: input.blockId, block, explanation };
      } else {
        operation = { type: 'add', block, explanation };
      }
    }
    return this.create(userId, {
      requestId: input.requestId,
      date: input.date,
      baseHash: input.baseHash,
      document: { schemaVersion: 1, operations: [operation] },
    });
  },
  async list(userId: string, date: string) {
    return prisma.planningProposal.findMany({
      where: { userId, planDate: day(date) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 30,
      select: { id: true, status: true, createdAt: true },
    });
  },
  async get(userId: string, id: string) {
    return database(async (tx) => {
      const row = await tx.planningProposal.findFirst({ where: { id, userId } });
      if (!row) {
        throw notFound();
      }
      let invalidReason: string | null = null;
      if (row.status === 'PENDING') {
        const s = await loadSnapshot(tx, userId, row.planDate.toISOString().slice(0, 10));
        if (s.hash !== row.baseHash) {
          invalidReason = stale().message;
        } else {
          try {
            validate(s, documentSchema.parse(row.document));
          } catch (error) {
            if (!(error instanceof TRPCError)) {
              throw error;
            }
            invalidReason = error.message;
          }
        }
      }
      return {
        id: row.id,
        status: row.status,
        date: row.planDate.toISOString().slice(0, 10),
        timezone: row.timezone,
        invalidReason,
        preview: previewSchema.parse(row.preview),
        receipt: row.receipt ? receiptSchema.parse(row.receipt) : null,
      };
    });
  },
  async discard(userId: string, id: string) {
    const result = await prisma.planningProposal.updateMany({
      where: { id, userId, status: 'PENDING' },
      data: { status: 'DISCARDED', resolvedAt: new Date() },
    });
    if (!result.count) {
      const row = await prisma.planningProposal.findFirst({
        where: { id, userId },
        select: { status: true },
      });
      if (!row) {
        throw notFound();
      }
      if (row.status !== 'DISCARDED') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'An applied proposal cannot be discarded.',
        });
      }
    }
    return { discarded: true };
  },
  async accept(userId: string, id: string) {
    return database(async (tx) => {
      const row = await tx.planningProposal.findFirst({ where: { id, userId } });
      if (!row) {
        throw notFound();
      }
      if (row.status === 'APPLIED') {
        return receiptSchema.parse(row.receipt);
      }
      if (row.status !== 'PENDING') {
        throw new TRPCError({ code: 'CONFLICT', message: 'This proposal was discarded.' });
      }
      const date = row.planDate.toISOString().slice(0, 10);
      const s = await loadSnapshot(tx, userId, date);
      if (s.hash !== row.baseHash) {
        throw stale();
      }
      const result = validate(s, documentSchema.parse(row.document));
      const plan =
        s.plan ??
        (await tx.dailyPlan.create({
          data: {
            userId,
            planDate: row.planDate,
            timezone: s.timezone,
            version: (s.plans.at(-1)?.version ?? 0) + 1,
            isCurrent: true,
            status: 'ACTIVE',
            generatedBy: 'MANUAL',
          },
        }));
      const occurrenceIds = new Map<string, string>();
      for (const reservation of result.reservations) {
        await tx.dailyPlanCategorySlot.create({
          data: {
            planId: plan.id,
            category: 'LEISURE',
            source: 'PLANNER',
            startsAt: reservation.startsAt,
            endsAt: reservation.endsAt,
          },
        });
      }
      const addedBlockIds: string[] = [];
      const changedBlockIds: string[] = [];
      const released = new Set<string>();
      for (const change of result.changes) {
        if (change.before && (!change.after || change.after.id !== change.before.id)) {
          await tx.dailyBlock.update({
            where: { id: change.before.id },
            data: { status: 'CANCELED' },
          });
          changedBlockIds.push(change.before.id);
          if (change.before.occurrenceId) {
            released.add(change.before.occurrenceId);
          }
        }
        const after = change.after;
        if (!after) {
          continue;
        }
        if (change.before && after.id === change.before.id) {
          await tx.dailyBlock.update({
            where: { id: after.id },
            data: {
              startsAt: after.startsAt,
              endsAt: after.endsAt,
              durationMinutes: after.durationMinutes,
            },
          });
          changedBlockIds.push(after.id);
          continue;
        }
        let occurrenceId = after.occurrenceId;
        if (after.taskId && !occurrenceId) {
          occurrenceId = occurrenceIds.get(after.taskId) ?? null;
          if (!occurrenceId) {
            const occurrence = await tx.taskOccurrence.create({
              data: {
                userId,
                taskId: after.taskId,
                occurrenceDate: row.planDate,
                origin: s.tasks.find((t) => t.id === after.taskId)?.isRecurring
                  ? 'RECURRENCE'
                  : 'MANUAL',
                status: 'SCHEDULED',
              },
            });
            occurrenceId = occurrence.id;
            occurrenceIds.set(after.taskId, occurrenceId);
          }
        }
        const created = await tx.dailyBlock.create({
          data: {
            userId,
            planId: plan.id,
            title: after.title,
            category: after.category,
            startsAt: after.startsAt,
            endsAt: after.endsAt,
            durationMinutes: after.durationMinutes,
            taskOccurrenceId: occurrenceId,
            source: 'PLANNER',
            status: 'PLANNED',
          },
        });
        addedBlockIds.push(created.id);
        if (occurrenceId) {
          await tx.taskOccurrence.update({
            where: { id: occurrenceId },
            data: { status: 'SCHEDULED' },
          });
        }
        if (after.taskId) {
          await tx.task.updateMany({
            where: { id: after.taskId, userId, isRecurring: false, status: 'BACKLOG' },
            data: { status: 'IN_PROGRESS' },
          });
        }
      }
      for (const occurrenceId of released) {
        const count = await tx.dailyBlock.count({
          where: {
            taskOccurrenceId: occurrenceId,
            plan: { isCurrent: true },
            status: { in: ['PLANNED', 'IN_PROGRESS', 'DONE'] },
          },
        });
        if (!count) {
          const occurrence = await tx.taskOccurrence.update({
            where: { id: occurrenceId },
            data: { status: 'PENDING' },
          });
          const commitments = await tx.dailyBlock.count({
            where: {
              userId,
              taskOccurrence: { taskId: occurrence.taskId },
              plan: { isCurrent: true },
              status: { in: ['PLANNED', 'IN_PROGRESS', 'DONE'] },
            },
          });
          if (!commitments) {
            await tx.task.updateMany({
              where: { id: occurrence.taskId, userId, isRecurring: false, status: 'IN_PROGRESS' },
              data: { status: 'BACKLOG' },
            });
          }
        }
      }
      await tx.dailyPlan.update({
        where: { id: plan.id },
        data: { status: 'ACTIVE', updatedAt: new Date() },
      });
      const receipt = {
        planId: plan.id,
        addedBlockIds,
        changedBlockIds,
        appliedAt: new Date().toISOString(),
      };
      await tx.planningProposal.update({
        where: { id },
        data: { status: 'APPLIED', resolvedAt: new Date(), receipt: json(receipt) },
      });
      return receipt;
    }, true);
  },
};
