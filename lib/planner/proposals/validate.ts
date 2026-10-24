import { mealKindSchema, mealTitles, readMealPreferences, type MealKind } from '../meals';
import type { Snapshot } from './snapshot';
import type { Addition, ProposalDocument } from './schema';
import { wallInstant } from './time';
import { occursOn } from './recurrence';

export type ProposalBlock = {
  id: string;
  title: string;
  mealKind?: MealKind | null;
  startsAt: Date;
  endsAt: Date;
  durationMinutes: number;
  category: 'WORK' | 'LIFE' | 'LEISURE' | 'REST' | null;
  taskId: string | null;
  occurrenceId: string | null;
  status: string;
  source: string;
  isFixed: boolean;
  calendarEventId: string | null;
};
export type Change = {
  type: string;
  explanation: string;
  before: ProposalBlock | null;
  after: ProposalBlock | null;
};
const occupied = (block: ProposalBlock) =>
  ['PLANNED', 'IN_PROGRESS', 'DONE'].includes(block.status);
const overlap = (a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) =>
  a.startsAt < b.endsAt && b.startsAt < a.endsAt;
const fail = (message: string): never => {
  throw new Error(message);
};
const minutes = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

export function existingBlocks(s: Snapshot): ProposalBlock[] {
  return s.blocks
    .filter((b) => b.planId === s.plan?.id)
    .map((b) => ({
      id: b.id,
      title: b.title,
      mealKind: b.mealKind ? mealKindSchema.parse(b.mealKind) : null,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      durationMinutes: b.durationMinutes,
      category: b.category,
      taskId: s.occurrences.find((o) => o.id === b.taskOccurrenceId)?.taskId ?? null,
      occurrenceId: b.taskOccurrenceId,
      status: b.status,
      source: b.source,
      isFixed: b.isFixed,
      calendarEventId: b.calendarEventId,
    }));
}

export function eligible(s: Snapshot, taskId: string, occurrenceId: string | null) {
  const task = s.tasks.find((t) => t.id === taskId) ?? fail('Task not found or inaccessible.');
  if (
    !['BACKLOG', 'IN_PROGRESS'].includes(task.status) ||
    (task.theme && task.theme.userId !== s.userId)
  ) {
    fail('This task is not eligible for planning.');
  }
  if (
    s.dependencies.some(
      (d) =>
        d.blockedTaskId === taskId &&
        d.isHardBlock &&
        (d.dependsOnTask.userId !== s.userId ||
          !['DONE', 'ARCHIVED'].includes(d.dependsOnTask.status))
    )
  ) {
    fail('This task has an unresolved hard prerequisite.');
  }
  if (occurrenceId) {
    const occurrence = s.occurrences.find((o) => o.id === occurrenceId && o.taskId === taskId);
    if (
      !occurrence ||
      !['PENDING', 'SCHEDULED'].includes(occurrence.status) ||
      occurrence.occurrenceDate > new Date(`${s.date}T00:00:00Z`)
    ) {
      fail('Occurrence not found, closed, or not yet eligible.');
    }
  } else if (
    (task.isRecurring && !occursOn(task, s.date)) ||
    s.occurrences.some(
      (o) =>
        o.taskId === taskId &&
        ((!task.isRecurring && ['PENDING', 'SCHEDULED'].includes(o.status)) ||
          o.occurrenceDate.toISOString().slice(0, 10) === s.date)
    )
  ) {
    fail('Choose an eligible existing occurrence for this task.');
  }
  return task;
}

export function availability(s: Snapshot) {
  const override = s.override;
  if (override && ['NO_WORK', 'PTO'].includes(override.workMode)) {
    return [];
  }
  const windows =
    override?.workMode === 'CUSTOM'
      ? override.availabilityWindows.length
        ? override.availabilityWindows
        : override.startTime && override.endTime
          ? [
              {
                startMinute:
                  override.startTime.getUTCHours() * 60 + override.startTime.getUTCMinutes(),
                endMinute: override.endTime.getUTCHours() * 60 + override.endTime.getUTCMinutes(),
              },
            ]
          : []
      : s.windows;
  const intervals = windows
    .filter((w) => w.endMinute > w.startMinute)
    .map((w) => ({
      startsAt: wallInstant(s.date, w.startMinute, s.timezone),
      endsAt: wallInstant(s.date, w.endMinute, s.timezone),
    }))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const merged: typeof intervals = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.startsAt <= previous.endsAt) {
      previous.endsAt = new Date(Math.max(previous.endsAt.getTime(), interval.endsAt.getTime()));
    } else {
      merged.push({ ...interval });
    }
  }
  let available = merged;
  for (const excluded of s.planningExclusions ?? []) {
    available = available.flatMap((window) => {
      if (!overlap(window, excluded)) {
        return [window];
      }
      return [
        ...(window.startsAt < excluded.startsAt
          ? [{ startsAt: window.startsAt, endsAt: excluded.startsAt }]
          : []),
        ...(window.endsAt > excluded.endsAt
          ? [{ startsAt: excluded.endsAt, endsAt: window.endsAt }]
          : []),
      ];
    });
  }
  return available;
}

export function validateProposal(s: Snapshot, document: ProposalDocument, now = new Date()) {
  const taskChanges: {
    taskId: string;
    title: string;
    estimatedMinutes?: number;
    complete?: boolean;
  }[] = [];
  const estimates = new Map<string, number>();
  for (const op of document.operations) {
    if (op.type === 'extend' && op.estimatedMinutes !== undefined) {
      const block = existingBlocks(s).find((b) => b.id === op.blockId);
      const task =
        s.tasks.find((t) => t.id === block?.taskId) ??
        fail('An estimate change requires an owned task block.');
      if (estimates.has(task.id) || op.estimatedMinutes < (task.estimatedMinutes ?? 25)) {
        fail('Provide one explicit increased total estimate per task.');
      }
      estimates.set(task.id, op.estimatedMinutes);
      taskChanges.push({
        taskId: task.id,
        title: task.title,
        estimatedMinutes: op.estimatedMinutes,
      });
    }
  }
  const estimateOf = (taskId: string | null) =>
    estimates.get(taskId ?? '') ?? s.tasks.find((t) => t.id === taskId)?.estimatedMinutes ?? 25;
  const blocks = new Map(existingBlocks(s).map((b) => [b.id, b]));
  const touched = new Set<string>();
  const changed = new Set<string>();
  const changes: Change[] = [];
  const dayStart = wallInstant(s.date, 0, s.timezone);
  const dayEnd = wallInstant(s.date, 1440, s.timezone);
  const cutoff = new Date(Math.max(dayStart.getTime(), Math.ceil(now.getTime() / 60_000) * 60_000));
  const windows = availability(s);
  const busy = s.events.filter((e) => e.isBusy);
  const originalSlots = s.plan?.categorySlots ?? [];
  const reservations = (document.reservations ?? []).map((slot) => ({
    ...slot,
    startsAt: new Date(slot.startsAt),
    endsAt: new Date(slot.endsAt),
  }));
  const slots = [...originalSlots, ...reservations];
  const taskKey = (b: ProposalBlock) => {
    const task = s.tasks.find((t) => t.id === b.taskId);
    return task?.isRecurring
      ? `occurrence:${b.occurrenceId ?? `${b.taskId}:${s.date}`}`
      : `task:${b.taskId}`;
  };
  const add = (input: Addition, id: string): ProposalBlock => {
    const task = input.kind === 'TASK' ? eligible(s, input.taskId, input.occurrenceId) : null;
    if (
      input.kind === 'MEAL' &&
      !readMealPreferences('mealPreferences' in s.settings ? s.settings.mealPreferences : null)[
        input.mealKind
      ].enabled
    ) {
      fail('This meal requirement is disabled. Enable it in Planner settings first.');
    }
    return {
      id,
      title: task?.title ?? (input.kind === 'MEAL' ? mealTitles[input.mealKind] : 'Short break'),
      mealKind: input.kind === 'MEAL' ? input.mealKind : null,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      durationMinutes: minutes(new Date(input.startsAt), new Date(input.endsAt)),
      taskId: task?.id ?? null,
      occurrenceId: input.kind === 'TASK' ? input.occurrenceId : null,
      category: task ? (task.category ?? task.theme?.category ?? 'WORK') : 'REST',
      status: 'PLANNED',
      source: 'PLANNER',
      isFixed: false,
      calendarEventId: null,
    };
  };
  for (const [index, operation] of document.operations.entries()) {
    let before: ProposalBlock | null = null;
    if (operation.type !== 'add') {
      if (touched.has(operation.blockId)) {
        fail('A block can be changed only once per proposal.');
      }
      touched.add(operation.blockId);
      before = blocks.get(operation.blockId) ?? fail('Block not found in the current plan.');
      const progress = operation.type === 'finish' || operation.type === 'extend';
      if (progress) {
        if (
          !['PLANNED', 'IN_PROGRESS'].includes(before.status) ||
          before.calendarEventId ||
          before.startsAt > now ||
          before.startsAt < dayStart ||
          before.startsAt >= dayEnd
        ) {
          fail('Progress requires an unfinished, started, non-calendar block on the selected day.');
        }
      } else if (
        before.status !== 'PLANNED' ||
        before.calendarEventId ||
        before.startsAt < cutoff ||
        ((before.isFixed || before.source === 'MANUAL') && !operation.explicit)
      ) {
        fail('Manual, fixed, started, completed, skipped and cancelled blocks are protected.');
      }
    }
    let after: ProposalBlock | null = null;
    if (operation.type === 'skip') {
      after = { ...before!, status: 'SKIPPED' };
    } else if (operation.type === 'finish' || operation.type === 'extend') {
      const endsAt = new Date(operation.endsAt);
      if (
        operation.type === 'finish' &&
        (endsAt > now || endsAt <= before!.startsAt || endsAt > dayEnd)
      ) {
        fail('Actual finish must follow the start and cannot be in the future or outside the day.');
      }
      if (operation.type === 'extend' && (endsAt <= before!.endsAt || endsAt <= cutoff)) {
        fail('An extension must increase the end and leave future work.');
      }
      if (!Number.isInteger(minutes(before!.startsAt, endsAt))) {
        fail('Actual work must use whole-minute durations.');
      }
      if (operation.type === 'extend' && before!.taskId) {
        eligible(s, before!.taskId, before!.occurrenceId);
      }
      after = {
        ...before!,
        endsAt,
        durationMinutes: minutes(before!.startsAt, endsAt),
        status: operation.type === 'finish' ? 'DONE' : 'IN_PROGRESS',
      };
      if (operation.type === 'finish' && operation.completeTask) {
        const task =
          s.tasks.find((t) => t.id === before!.taskId) ??
          fail('Only task work can complete a task.');
        eligible(s, task.id, before!.occurrenceId);
        taskChanges.push({ taskId: task.id, title: task.title, complete: true });
      }
    } else if (operation.type === 'add' || operation.type === 'replace') {
      after = add(operation.block, `new:${index}`);
    } else if (operation.type === 'move' || operation.type === 'resize') {
      after = {
        ...before!,
        startsAt: new Date(operation.startsAt),
        endsAt: new Date(operation.endsAt),
        durationMinutes: minutes(new Date(operation.startsAt), new Date(operation.endsAt)),
      };
      if (operation.type === 'move' && after.durationMinutes !== before!.durationMinutes) {
        fail('A move must preserve duration. Use a duration change instead.');
      }
      if (operation.type === 'resize' && after.startsAt.getTime() !== before!.startsAt.getTime()) {
        fail('A duration change must preserve the start time.');
      }
      if (after.mealKind && operation.explicit) {
        after.isFixed = true;
      }
      if (after.taskId) {
        eligible(s, after.taskId, after.occurrenceId);
      }
    }
    if (before) {
      blocks.delete(before.id);
    }
    if (after) {
      blocks.set(after.id, after);
      changed.add(after.id);
    }
    changes.push({ type: operation.type, explanation: operation.explanation, before, after });
  }
  const final = [...blocks.values()];
  const mealCounts = new Set<string>();
  for (const block of final) {
    if (!block.mealKind) {
      continue;
    }
    if (mealCounts.has(block.mealKind)) {
      fail('A day can contain only one block per meal, including skipped or cancelled meals.');
    }
    mealCounts.add(block.mealKind);
  }
  // A cancelled meal remains an intentional daily override in persistence.
  for (const change of changes) {
    if (
      change.after?.mealKind &&
      change.after.id.startsWith('new:') &&
      s.blocks.some((b) => b.planId === s.plan?.id && b.mealKind === change.after!.mealKind)
    ) {
      fail('This meal already has a block for the selected day. Edit the existing block.');
    }
  }
  const isOccupied = (b: ProposalBlock) =>
    occupied(b) &&
    (!b.calendarEventId || s.events.find((e) => e.id === b.calendarEventId)?.isBusy !== false);
  for (const interval of document.freeIntervals ?? []) {
    const free = { startsAt: new Date(interval.startsAt), endsAt: new Date(interval.endsAt) };
    if (
      free.startsAt < cutoff ||
      free.endsAt <= free.startsAt ||
      free.endsAt > dayEnd ||
      final.some((block) => isOccupied(block) && overlap(free, block)) ||
      busy.some((event) => overlap(free, event))
    ) {
      fail(
        'The requested free interval contains occupied time, crosses the selected day, or has already started. Adjust protected commitments explicitly.'
      );
    }
  }
  for (const [index, slot] of reservations.entries()) {
    if (slot.startsAt < cutoff) {
      fail(
        'This proposal’s start time has passed. Generate a fresh preview to keep all changes within future availability.'
      );
    }
    if (
      slot.endsAt <= slot.startsAt ||
      slot.endsAt > dayEnd ||
      !windows.some((w) => slot.startsAt >= w.startsAt && slot.endsAt <= w.endsAt) ||
      originalSlots.some((other) => overlap(slot, other)) ||
      reservations.slice(index + 1).some((other) => overlap(slot, other)) ||
      busy.some((event) => overlap(slot, event)) ||
      final.some(
        (block) =>
          isOccupied(block) &&
          overlap(slot, block) &&
          ((block.category !== 'LEISURE' && block.category !== 'REST') ||
            block.startsAt < slot.startsAt ||
            block.endsAt > slot.endsAt)
      )
    ) {
      fail(
        'New leisure reservations must fit future availability without conflicting with reservations or occupied time.'
      );
    }
  }
  for (const block of final.filter((b) => changed.has(b.id))) {
    if (block.status === 'SKIPPED') {
      continue;
    }
    const progress = changes.find(
      (c) => c.after?.id === block.id && (c.type === 'finish' || c.type === 'extend')
    );
    // Actual history is recorded even when the calendar/availability changed meanwhile.
    if (progress?.type === 'finish') {
      continue;
    }
    if (!progress && block.startsAt < cutoff) {
      fail(
        'This proposal’s start time has passed. Generate a fresh preview to keep all changes within future availability.'
      );
    }
    if (
      !Number.isInteger(block.durationMinutes) ||
      block.durationMinutes <= 0 ||
      block.endsAt > dayEnd ||
      !windows.some(
        (w) =>
          (progress
            ? new Date(Math.max(block.startsAt.getTime(), cutoff.getTime()))
            : block.startsAt) >= w.startsAt && block.endsAt <= w.endsAt
      )
    ) {
      fail(
        'Changed blocks must have positive whole-minute durations within future availability and the selected day.'
      );
    }
    if (
      busy.some((e) => overlap(block, e)) ||
      final.some((other) => other.id !== block.id && isOccupied(other) && overlap(block, other))
    ) {
      fail('A proposed block overlaps occupied time or a busy calendar event.');
    }
    const intersectingSlots = slots.filter((slot) => overlap(block, slot));
    if (
      block.category !== 'REST' &&
      intersectingSlots.some(
        (slot) =>
          slot.category !== block.category ||
          block.startsAt < slot.startsAt ||
          block.endsAt > slot.endsAt
      )
    ) {
      fail('Task placement conflicts with a category reservation.');
    }
    if (
      block.category === 'LEISURE' &&
      !intersectingSlots.some(
        (slot) =>
          slot.category === 'LEISURE' &&
          block.startsAt >= slot.startsAt &&
          block.endsAt <= slot.endsAt
      )
    ) {
      fail('Leisure tasks need a matching leisure reservation.');
    }
    const task = s.tasks.find((t) => t.id === block.taskId);
    if (task?.earliestStartAt && block.startsAt < task.earliestStartAt) {
      fail('This task cannot start before its earliest start time.');
    }
  }
  // Count preserved commitments in every current plan, excluding the edited day's replaced allocations.
  const otherBlocks: ProposalBlock[] = s.blocks
    .filter((b) => b.planId !== s.plan?.id)
    .map((b) => ({
      ...b,
      mealKind: b.mealKind ? mealKindSchema.parse(b.mealKind) : null,
      occurrenceId: b.taskOccurrenceId,
      taskId: s.occurrences.find((o) => o.id === b.taskOccurrenceId)?.taskId ?? null,
    }));
  const allocations = [...otherBlocks, ...final].filter((b) => b.taskId && occupied(b));
  const totals = new Map<string, number>();
  for (const block of allocations) {
    totals.set(taskKey(block), (totals.get(taskKey(block)) ?? 0) + block.durationMinutes);
  }
  for (const block of final.filter((b) => changed.has(b.id) && b.taskId)) {
    const estimate = estimateOf(block.taskId);
    if (
      occupied(block) &&
      block.status !== 'DONE' &&
      (totals.get(taskKey(block)) ?? 0) > estimate
    ) {
      fail(
        'Proposed time exceeds the task’s remaining estimate after completed work and commitments.'
      );
    }
  }
  // Compare session metrics with the baseline so deleting/moving a break cannot
  // invalidate untouched downstream work. Existing violations may remain, not worsen.
  const sessionMetrics = (
    items: ProposalBlock[],
    allocationTotals: Map<string, number>,
    allAllocations: ProposalBlock[]
  ) => {
    const timeline = items
      .filter((b) => isOccupied(b) && b.endsAt > dayStart && b.startsAt < dayEnd)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const metrics = new Map<string, { work: number; leisure: number; invalid: boolean }>();
    let work = 0;
    let leisure = 0;
    let previous: ProposalBlock | undefined;
    for (const block of timeline) {
      if (previous) {
        let freeStart = previous.endsAt.getTime();
        let longestFree = 0;
        for (const event of busy
          .filter((e) => e.endsAt > previous!.endsAt && e.startsAt < block.startsAt)
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
          longestFree = Math.max(
            longestFree,
            Math.min(event.startsAt.getTime(), block.startsAt.getTime()) - freeStart
          );
          freeStart = Math.max(freeStart, event.endsAt.getTime());
        }
        longestFree = Math.max(longestFree, block.startsAt.getTime() - freeStart);
        if (longestFree >= s.settings.shortBreakMinutes * 60_000) {
          work = 0;
          leisure = 0;
        }
      }
      let invalid = false;
      if (block.category === 'REST') {
        if (block.durationMinutes >= s.settings.shortBreakMinutes) {
          work = 0;
          leisure = 0;
        }
      } else if (block.category === 'LEISURE') {
        leisure += block.durationMinutes;
        invalid = leisure > s.settings.maxLeisureBlockMinutes;
        if (leisure >= s.settings.shortBreakMinutes) {
          work = 0;
        }
      } else if (block.taskId) {
        const target = s.settings.workSessionMinutes;
        const sameTask = previous?.taskId && taskKey(previous) === taskKey(block);
        const estimate = estimateOf(block.taskId);
        const finishes =
          (allocationTotals.get(taskKey(block)) ?? 0) === estimate &&
          !allAllocations.some(
            (later) =>
              later.taskId && later.startsAt >= block.endsAt && taskKey(later) === taskKey(block)
          );
        invalid =
          (work >= target && !sameTask) ||
          work + block.durationMinutes > target + 30 ||
          (work + block.durationMinutes > target && !finishes);
        work += block.durationMinutes;
        leisure = 0;
      }
      metrics.set(block.id, { work, leisure, invalid: Boolean(invalid) });
      previous = block;
    }
    return metrics;
  };
  const original = existingBlocks(s);
  const baselineTotals = new Map<string, number>();
  for (const block of [...otherBlocks, ...original].filter((b) => b.taskId && occupied(b))) {
    baselineTotals.set(
      taskKey(block),
      (baselineTotals.get(taskKey(block)) ?? 0) + block.durationMinutes
    );
  }
  const baseline = sessionMetrics(
    original,
    baselineTotals,
    [...otherBlocks, ...original].filter((b) => b.taskId && occupied(b))
  );
  for (const [id, metric] of sessionMetrics(final, totals, allocations)) {
    const old = baseline.get(id);
    if (
      metric.invalid &&
      !changes.some((c) => c.type === 'finish' && c.after?.id === id) &&
      (changed.has(id) || !old?.invalid || metric.work > old.work || metric.leisure > old.leisure)
    ) {
      fail(
        'Take a qualifying break; the 30-minute session extension may only finish the current task, and leisure must stay within its session limit.'
      );
    }
  }
  for (const op of document.operations) {
    if (op.type !== 'finish' || !op.completeTask) {
      continue;
    }
    const finished = changes.find((c) => c.before?.id === op.blockId)!.after!;
    if (allocations.some((b) => b.status !== 'DONE' && taskKey(b) === taskKey(finished))) {
      fail('Completing work requires releasing its remaining commitments, including other days.');
    }
  }
  const warnings: string[] = [];
  if (changes.some((c) => c.type === 'finish')) {
    warnings.push(
      'Actual work is recorded as entered. Finishing a block only completes its task or occurrence when explicitly selected.'
    );
  }
  if ([...baseline.values()].some((metric) => metric.invalid)) {
    warnings.push(
      'Existing blocks exceed the session policy. They are retained; proposed changes cannot worsen this.'
    );
  }
  if (
    changes.some(
      (c) =>
        c.type === 'finish' &&
        c.after &&
        (busy.some((e) => overlap(c.after!, e)) ||
          final.some((b) => b.id !== c.after!.id && isOccupied(b) && overlap(c.after!, b)))
    )
  ) {
    warnings.push(
      'Recorded actual work overlaps another block or busy event. History is retained; review the overlapping records.'
    );
  }
  const unchanged = final.filter((b) => !changed.has(b.id) && isOccupied(b));
  if (
    unchanged.some(
      (b, i) =>
        busy.some((e) => e.id !== b.calendarEventId && overlap(b, e)) ||
        unchanged.slice(i + 1).some((other) => overlap(b, other))
    )
  ) {
    warnings.push(
      'Existing protected blocks conflict with other occupied time. They are retained.'
    );
  }
  if (
    slots.some(
      (slot) => !windows.some((w) => slot.startsAt >= w.startsAt && slot.endsAt <= w.endsAt)
    )
  ) {
    warnings.push('An existing category reservation extends outside availability. It is retained.');
  }
  return {
    freeIntervals: document.freeIntervals,
    sessionViolations: [...sessionMetrics(final, totals, allocations)]
      .filter(([, metric]) => metric.invalid)
      .map(([id]) => id),
    reservations,
    taskChanges,
    changes,
    final,
    warnings,
    remaining: [
      ...new Map(
        changes
          .flatMap((change) => [change.before, change.after])
          .filter((block): block is ProposalBlock => Boolean(block?.taskId))
          .map((block) => [taskKey(block), block])
      ).entries(),
    ].map(([key, block]) => ({
      key,
      taskId: block.taskId!,
      title: block.title,
      minutes: document.operations.some(
        (op) =>
          op.type === 'finish' &&
          op.completeTask &&
          changes.some((c) => c.before?.id === op.blockId && c.after && taskKey(c.after) === key)
      )
        ? 0
        : Math.max(0, estimateOf(block.taskId) - (totals.get(key) ?? 0)),
    })),
  };
}
