import 'server-only';
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { draftService } from './service';
import { editWorkingDraft } from './manual';
import { generateWorkingDraft } from './generation';
import { wallInstant, timeMinute } from '../proposals/time';
import { existingBlocks } from '../proposals/validate';
import type { PlanningCategoryValue } from '../tasks';

// Older clients must also stage schedule edits. They can refresh Planner Today
// to review/accept the resulting draft; no compatibility path writes active plans.
async function command(userId: string, date: string) {
  const { draft } = await draftService.read(userId, date);
  return {
    date,
    requestId: randomUUID(),
    draftId: draft?.id ?? null,
    expectedVersion: draft?.version ?? 0,
  };
}
export const legacyDraftCommands = {
  async add(userId: string, input: { date: string; taskId: string; startsAt: string }) {
    return editWorkingDraft(userId, {
      ...(await command(userId, input.date)),
      ...input,
      action: 'add',
    });
  },
  async move(
    userId: string,
    input: { date: string; blockId: string; startsAt: string; endsAt: string }
  ) {
    return editWorkingDraft(userId, {
      ...(await command(userId, input.date)),
      ...input,
      action: 'time',
    });
  },
  async remove(userId: string, input: { date: string; blockId: string }) {
    return editWorkingDraft(userId, {
      ...(await command(userId, input.date)),
      ...input,
      action: 'remove',
    });
  },
  async slot(
    userId: string,
    input: {
      date: string;
      slotId?: string;
      category?: PlanningCategoryValue;
      startsAt?: string;
      endsAt?: string;
    },
    action: 'add' | 'move' | 'remove'
  ) {
    const { snapshot } = await draftService.snapshot(userId, input.date);
    const instant = (value: string | undefined) =>
      value
        ? wallInstant(
            value.slice(0, 10),
            timeMinute(value.slice(11, 16)),
            snapshot.timezone
          ).toISOString()
        : undefined;
    return draftService.slot(userId, {
      ...(await command(userId, input.date)),
      action,
      slotId: input.slotId,
      category: input.category,
      startsAt: instant(input.startsAt),
      endsAt: instant(input.endsAt),
    });
  },
  async accept(userId: string, date: string) {
    const input = await command(userId, date);
    if (!input.draftId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Open Planner Today to create and review a working draft.',
      });
    }
    return draftService.accept(userId, input);
  },
  async generate(userId: string, date: string) {
    return generateWorkingDraft(userId, {
      ...(await command(userId, date)),
      mode: 'deterministic',
    });
  },
  async clear(userId: string, date: string) {
    const { snapshot } = await draftService.snapshot(userId, date);
    const operations = existingBlocks(snapshot)
      .filter(
        (b) =>
          b.status === 'PLANNED' &&
          b.startsAt >= new Date() &&
          !b.isFixed &&
          !b.isLocked &&
          !b.calendarEventId
      )
      .map((b) => ({
        type: 'remove' as const,
        blockId: b.id,
        explicit: true as const,
        explanation: 'Clear eligible future work in the draft.',
      }));
    if (!operations.length) {
      return { unchanged: true };
    }
    return draftService.apply(userId, {
      ...(await command(userId, date)),
      document: { schemaVersion: 1, operations },
      origin: 'manual',
      label: 'Clear future draft',
    });
  },
};
