import 'server-only';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { draftCommandSchema } from './schema';
import { mutateDraft } from './service';
import { wallInstant, timeMinute } from '../proposals/time';
import { eligible, existingBlocks } from '../proposals/validate';
import type { ProposalOperation } from '../proposals/schema';

export const manualDraftSchema = draftCommandSchema
  .extend({
    action: z.enum(['add', 'move', 'resize', 'time', 'remove']),
    taskId: z.uuid().optional(),
    blockId: z.uuid().optional(),
    startsAt: z.string().max(30).optional(),
    endsAt: z.string().max(30).optional(),
  })
  .strict();
export async function editWorkingDraft(userId: string, raw: z.input<typeof manualDraftSchema>) {
  const input = manualDraftSchema.parse(raw);
  return mutateDraft(userId, input, 'manual-edit', (s) => {
    const instant = (value: string | undefined) => {
      if (!value || !new RegExp(`^${input.date}[ T]\\d{2}:\\d{2}(?::00)?$`).test(value)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Choose a time on the selected date.',
        });
      }
      try {
        return wallInstant(input.date, timeMinute(value.slice(11, 16)), s.timezone).toISOString();
      } catch (error) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: (error as Error).message });
      }
    };
    let operation: ProposalOperation;
    const explanation = 'Manual calendar edit';
    if (input.action === 'add') {
      const task = s.tasks.find((t) => t.id === input.taskId);
      if (!task) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose an owned task.' });
      }
      const occurrences = s.occurrences
        .filter((o) => o.taskId === task.id && ['PENDING', 'SCHEDULED'].includes(o.status))
        .sort((a, b) => a.occurrenceDate.getTime() - b.occurrenceDate.getTime());
      const occurrenceId =
        occurrences.find((o) => o.occurrenceDate.toISOString().slice(0, 10) === input.date)?.id ??
        occurrences[0]?.id ??
        null;
      try {
        eligible(s, task.id, occurrenceId);
      } catch (error) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: (error as Error).message });
      }
      const startsAt = instant(input.startsAt);
      const endsAt = new Date(
        new Date(startsAt).getTime() + (task.estimatedMinutes ?? 25) * 60000
      ).toISOString();
      operation = {
        type: 'add',
        block: { kind: 'TASK', taskId: task.id, occurrenceId, startsAt, endsAt },
        explanation,
      };
    } else {
      const block = existingBlocks(s).find((b) => b.id === input.blockId);
      if (!block) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Block not found on this date.' });
      }
      operation =
        input.action === 'remove'
          ? { type: 'remove', blockId: block.id, explanation }
          : {
              type:
                input.action === 'time'
                  ? instant(input.startsAt) === block.startsAt.toISOString()
                    ? 'resize'
                    : 'move'
                  : input.action,
              blockId: block.id,
              startsAt: instant(input.startsAt),
              endsAt: instant(input.endsAt),
              explanation,
            };
    }
    return { schemaVersion: 1, operations: [operation] };
  });
}
