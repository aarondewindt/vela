import { randomUUID } from 'node:crypto';
import { fingerprint, type Snapshot } from '../proposals/snapshot';
import {
  existingBlocks,
  validateProposal,
  type ProposalBlock,
  type ValidationPolicy,
} from '../proposals/validate';
import type { Addition, ProposalDocument, ProposalOperation } from '../proposals/schema';
import { wallInstant } from '../proposals/time';
import { draftStateSchema, type DraftState } from './schema';

export function initialState(s: Snapshot): DraftState {
  return draftStateSchema.parse({
    blocks: JSON.parse(JSON.stringify(existingBlocks(s))),
    slots: JSON.parse(JSON.stringify(s.plan?.categorySlots ?? [])),
  });
}
// Ignore ordering and intent annotations when deciding whether cancellation needs confirmation.
export function scheduleHash(state: DraftState) {
  return fingerprint({
    blocks: state.blocks
      .map(({ id: _, manualOverride: __, source: ___, ...b }) => b)
      .sort((a, b) => fingerprint(a).localeCompare(fingerprint(b))),
    slots: state.slots
      .map(({ id: _, source: __, ...slot }) => slot)
      .sort((a, b) => fingerprint(a).localeCompare(fingerprint(b))),
    freeIntervals: state.freeIntervals ?? [],
    taskLimits: state.taskLimits ?? [],
  });
}

/** Only authoritative inputs relevant to this day and its scheduled tasks. */
export function inputHash(s: Snapshot, state: DraftState) {
  const ids = new Set(state.blocks.flatMap((b) => (b.taskId ? [b.taskId] : [])));
  const start = wallInstant(s.date, 0, s.timezone);
  const end = wallInstant(s.date, 1440, s.timezone);
  return fingerprint({
    plan: s.plan && {
      id: s.plan.id,
      version: s.plan.version,
      status: s.plan.status,
      timezone: s.plan.timezone,
    },
    active: initialState(s),
    timezone: s.user.timezone,
    tasks: s.tasks
      .filter((t) => ids.has(t.id))
      .map((t) => ({
        id: t.id,
        status: t.status,
        estimatedMinutes: t.estimatedMinutes,
        earliestStartAt: t.earliestStartAt,
        isRecurring: t.isRecurring,
        recurrenceRule: t.recurrenceRule,
        recurrenceAnchorDate: t.recurrenceAnchorDate,
        category: t.category,
        themeCategory: t.theme?.category,
      })),
    occurrences: s.occurrences
      .filter((o) => ids.has(o.taskId))
      .map(({ updatedAt: _, createdAt: __, ...o }) => o),
    dependencies: s.dependencies
      .filter((d) => ids.has(d.blockedTaskId))
      .map((d) => ({
        id: d.id,
        blockedTaskId: d.blockedTaskId,
        dependsOnTaskId: d.dependsOnTaskId,
        isHardBlock: d.isHardBlock,
        prerequisite: d.dependsOnTask,
      })),
    availability: s.availabilitySnapshot,
    events: s.events
      .filter((e) => e.isBusy && e.startsAt < end && e.endsAt > start)
      .map((e) => ({ id: e.id, startsAt: e.startsAt, endsAt: e.endsAt })),
    settings: {
      workSessionMinutes: s.settings.workSessionMinutes,
      shortBreakMinutes: s.settings.shortBreakMinutes,
      maxLeisureBlockMinutes: s.settings.maxLeisureBlockMinutes,
      mealPreferences: s.settings.mealPreferences,
    },
    commitments: s.blocks
      .filter(
        (b) =>
          b.planId !== s.plan?.id &&
          s.occurrences.some((o) => o.id === b.taskOccurrenceId && ids.has(o.taskId))
      )
      .map((b) => ({
        id: b.id,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        status: b.status,
        occurrenceId: b.taskOccurrenceId,
      })),
  });
}

/** Adapt a complete draft to the existing scheduler/validator snapshot contract. No DB writes. */
export function withDraft(s: Snapshot, state: DraftState): Snapshot {
  const planId = s.plan?.id ?? 'draft';
  const stamp = new Date(0);
  return {
    ...s,
    draftTaskIds: Object.fromEntries(
      state.blocks.flatMap((b) => (b.taskId ? [[b.id, b.taskId]] : []))
    ),
    plan: {
      ...(s.plan ?? {
        id: planId,
        userId: s.userId,
        planDate: new Date(`${s.date}T00:00:00Z`),
        timezone: s.timezone,
        status: 'DRAFT',
        version: 0,
        isCurrent: false,
        generatedBy: 'MANUAL',
        explanationJson: null,
        createdAt: stamp,
        updatedAt: stamp,
        finalizedAt: null,
      }),
      categorySlots: state.slots.map((slot) => ({
        ...slot,
        planId,
        startsAt: new Date(slot.startsAt),
        endsAt: new Date(slot.endsAt),
        createdAt: stamp,
        updatedAt: stamp,
      })),
    },
    blocks: [
      ...s.blocks.filter((b) => b.planId !== s.plan?.id),
      ...state.blocks.map((b) => ({
        id: b.id,
        userId: s.userId,
        planId,
        taskOccurrenceId: b.occurrenceId,
        calendarEventId: b.calendarEventId,
        category: b.category,
        title: b.title,
        brief: null,
        content: null,
        mealKind: b.mealKind ?? null,
        startsAt: new Date(b.startsAt),
        endsAt: new Date(b.endsAt),
        durationMinutes: b.durationMinutes,
        status: b.status,
        source: b.source,
        position: null,
        isFixed: b.isFixed,
        manualOverride: b.manualOverride,
        isLocked: b.isLocked,
        completedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
      })),
    ],
    planningExclusions: state.freeIntervals?.map((f) => ({
      startsAt: new Date(f.startsAt),
      endsAt: new Date(f.endsAt),
    })),
    planningTaskLimits: state.taskLimits,
  };
}
function addition(b: DraftState['blocks'][number]): Addition {
  const times = { startsAt: b.startsAt, endsAt: b.endsAt };
  return b.taskId
    ? { kind: 'TASK', taskId: b.taskId, occurrenceId: b.occurrenceId, ...times }
    : b.mealKind
      ? { kind: 'MEAL', mealKind: b.mealKind, ...times }
      : { kind: 'REST', ...times };
}

/** Revalidate the complete net change, rather than replaying now-obsolete intermediate edits. */
export function netDocument(base: DraftState, state: DraftState): ProposalDocument {
  const operations: ProposalOperation[] = [];
  const explanation = 'Accept working draft.';
  for (const before of base.blocks) {
    const after = state.blocks.find((b) => b.id === before.id);
    if (!after) {
      operations.push({ type: 'remove', blockId: before.id, explicit: true, explanation });
    } else if (before.startsAt !== after.startsAt || before.endsAt !== after.endsAt) {
      if (before.startsAt === after.startsAt || before.durationMinutes === after.durationMinutes) {
        operations.push({
          type: before.startsAt === after.startsAt ? 'resize' : 'move',
          blockId: before.id,
          startsAt: after.startsAt,
          endsAt: after.endsAt,
          explicit: true,
          explanation,
        });
      } else {
        operations.push({
          type: 'retime',
          blockId: before.id,
          startsAt: after.startsAt,
          endsAt: after.endsAt,
          explicit: true,
          explanation,
        });
      }
    }
  }
  for (const b of state.blocks.filter((b) => !base.blocks.some((old) => old.id === b.id))) {
    operations.push({ type: 'add', block: addition(b), explanation });
  }
  return {
    schemaVersion: 1,
    operations,
    reservations: state.slots
      .filter((slot) => !base.slots.some((old) => fingerprint(old) === fingerprint(slot)))
      .map((slot) => {
        return {
          category: slot.category,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          explanation,
        };
      }),
    freeIntervals: state.freeIntervals,
    taskLimits: state.taskLimits,
  };
}

export function validateDraft(
  s: Snapshot,
  base: DraftState,
  state: DraftState,
  now = new Date(),
  policy: ValidationPolicy = 'acceptance'
) {
  const slotsChanged = fingerprint(base.slots) !== fingerprint(state.slots);
  const snapshot =
    slotsChanged && s.plan
      ? {
          ...s,
          plan: {
            ...s.plan,
            categorySlots: s.plan.categorySlots.filter((slot) =>
              state.slots.some(
                (next) =>
                  next.id === slot.id &&
                  next.startsAt === slot.startsAt.toISOString() &&
                  next.endsAt === slot.endsAt.toISOString() &&
                  next.category === slot.category
              )
            ),
          },
        }
      : s;
  const validated = validateProposal(snapshot, netDocument(base, state), now, {
    validateAllFuture: slotsChanged,
    policy,
  });
  if (policy === 'acceptance') {
    const conflicts = draftAcceptanceConflicts(s, state, now);
    if (conflicts.length) {
      throw new Error(`Draft acceptance conflicts:\n- ${conflicts.join('\n- ')}`);
    }
  }
  return validated;
}

const overlaps = (a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) =>
  a.startsAt < b.endsAt && b.startsAt < a.endsAt;

const localRange = (startsAt: Date, endsAt: Date, timezone: string) => {
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return `${format.format(startsAt)}–${format.format(endsAt)}`;
};

/** Hard active-schedule consistency, intentionally excluding scheduler guidance. */
export function draftAcceptanceConflicts(s: Snapshot, state: DraftState, _now = new Date()) {
  const conflicts: string[] = [];
  const start = wallInstant(s.date, 0, s.timezone);
  const end = wallInstant(s.date, 1440, s.timezone);
  const occupied = state.blocks.filter((block) => {
    const event = block.calendarEventId
      ? s.events.find((candidate) => candidate.id === block.calendarEventId)
      : null;
    return ['PLANNED', 'IN_PROGRESS', 'DONE'].includes(block.status) && event?.isBusy !== false;
  });
  for (const block of state.blocks) {
    const startsAt = new Date(block.startsAt);
    const endsAt = new Date(block.endsAt);
    const actualMinutes = (endsAt.getTime() - startsAt.getTime()) / 60_000;
    if (
      startsAt < start ||
      endsAt > end ||
      endsAt <= startsAt ||
      !Number.isInteger(actualMinutes) ||
      block.durationMinutes !== actualMinutes
    ) {
      conflicts.push(
        `Block “${block.title}” (${block.id}) has an invalid interval ${localRange(startsAt, endsAt, s.timezone)}.`
      );
    }
  }
  for (let index = 0; index < occupied.length; index += 1) {
    const block = occupied[index];
    for (const other of occupied.slice(index + 1)) {
      if (
        overlaps(
          { startsAt: new Date(block.startsAt), endsAt: new Date(block.endsAt) },
          {
            startsAt: new Date(other.startsAt),
            endsAt: new Date(other.endsAt),
          }
        )
      ) {
        conflicts.push(
          `Block “${block.title}” (${block.id}, ${localRange(new Date(block.startsAt), new Date(block.endsAt), s.timezone)}) overlaps block “${other.title}” (${other.id}, ${localRange(new Date(other.startsAt), new Date(other.endsAt), s.timezone)}).`
        );
      }
    }
  }
  for (const block of occupied) {
    for (const event of s.events.filter((candidate) => candidate.isBusy)) {
      if (
        event.id !== block.calendarEventId &&
        overlaps({ startsAt: new Date(block.startsAt), endsAt: new Date(block.endsAt) }, event)
      ) {
        conflicts.push(
          `Block “${block.title}” (${block.id}, ${localRange(new Date(block.startsAt), new Date(block.endsAt), s.timezone)}) overlaps busy calendar event “${event.title}” (${event.id}, ${localRange(event.startsAt, event.endsAt, s.timezone)}).`
        );
      }
    }
  }
  for (let index = 0; index < state.slots.length; index += 1) {
    const slot = state.slots[index];
    const startsAt = new Date(slot.startsAt);
    const endsAt = new Date(slot.endsAt);
    if (startsAt < start || endsAt > end || endsAt <= startsAt) {
      conflicts.push(
        `${slot.category} reservation (${slot.id}) has an invalid interval ${localRange(startsAt, endsAt, s.timezone)}.`
      );
    }
    for (const other of state.slots.slice(index + 1)) {
      if (
        overlaps(
          { startsAt, endsAt },
          { startsAt: new Date(other.startsAt), endsAt: new Date(other.endsAt) }
        )
      ) {
        conflicts.push(
          `${slot.category} reservation (${slot.id}, ${localRange(startsAt, endsAt, s.timezone)}) overlaps ${other.category} reservation (${other.id}, ${localRange(new Date(other.startsAt), new Date(other.endsAt), s.timezone)}).`
        );
      }
    }
  }
  return conflicts;
}

export function applyDocument(
  s: Snapshot,
  state: DraftState,
  document: ProposalDocument,
  origin: 'manual' | 'ai',
  now = new Date(),
  preserveIntent = false
): DraftState {
  if (document.operations.some((op) => ['finish', 'extend', 'skip'].includes(op.type))) {
    throw new Error(
      'Record actual progress separately on the active schedule. Draft edits cannot change task outcomes.'
    );
  }
  const operations = document.operations.map((op) =>
    origin === 'manual' && op.type !== 'add' ? { ...op, explicit: true as const } : op
  );
  const merged = {
    ...document,
    operations,
    freeIntervals: document.freeIntervals ?? state.freeIntervals,
    taskLimits: document.taskLimits ?? state.taskLimits,
  };
  const validated = validateProposal(withDraft(s, state), merged, now, {
    policy: origin === 'manual' || preserveIntent ? 'manual' : 'strict',
  });
  const changed = new Set(validated.changes.flatMap((c) => (c.after ? [c.after.id] : [])));
  const blocks = validated.final.map((b: ProposalBlock) => ({
    ...b,
    id: b.id.startsWith('new:') ? randomUUID() : b.id,
    manualOverride:
      b.manualOverride || ((origin === 'manual' || preserveIntent) && changed.has(b.id)),
    source: origin === 'manual' && b.id.startsWith('new:') ? 'MANUAL' : b.source,
  }));
  return draftStateSchema.parse(
    JSON.parse(
      JSON.stringify({
        blocks,
        slots: [
          ...state.slots,
          ...validated.reservations.map((slot) => ({
            ...slot,
            id: randomUUID(),
            source: origin === 'manual' ? 'MANUAL' : 'PLANNER',
          })),
        ],
        freeIntervals: merged.freeIntervals,
        taskLimits: merged.taskLimits,
        generation: document.generation ?? state.generation,
      })
    )
  );
}
