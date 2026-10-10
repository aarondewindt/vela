export type CandidateTier = 'OVERDUE' | 'DUE_SOON' | 'IMPORTANT' | 'FILLER';
export type PlanningCategory = 'WORK' | 'LIFE' | 'LEISURE' | 'REST';

export type PlanningCandidate = {
  id: string;
  title: string;
  priority: number;
  size: number;
  tier: CandidateTier;
  daysUntilDue: number | null;
  dueAt: Date | null;
  durationMinutes: number;
  category: PlanningCategory;
};

export type TimeInterval = {
  start: Date;
  end: Date;
};

export type GeneratorOptions = {
  workSessionMinutes: number;
  shortBreakMinutes: number;
  leisureMinutes: number;
  shortLeisureBlockMinutes: number;
  maxLeisureBlockMinutes: number;
  fillExistingPlan: boolean;
};

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  workSessionMinutes: 90,
  shortBreakMinutes: 15,
  leisureMinutes: 60,
  shortLeisureBlockMinutes: 30,
  maxLeisureBlockMinutes: 90,
  fillExistingPlan: true,
};

export type PlanningProfile = {
  gapMinutes: number;
  sessionMinutes: number;
  leisureMinutes: number;
  shortLeisureBlockMinutes: number;
  maxLeisureBlockMinutes: number;
};

export type ScheduledCandidate = PlanningCandidate & TimeInterval;

export type UnscheduledCandidate = {
  candidate: PlanningCandidate;
  reason: 'invalid-duration' | 'no-available-slot';
};

export type DaySchedule = {
  scheduled: ScheduledCandidate[];
  breaks: ScheduledCandidate[];
  leisure: ScheduledCandidate[];
  reservations: ScheduledCandidate[];
  unscheduled: UnscheduledCandidate[];
  freeWindows: TimeInterval[];
};

export type CategorySlot = TimeInterval & { id: string; category: PlanningCategory };

export const WEEKDAY_PLANNING_PROFILE: PlanningProfile = {
  gapMinutes: DEFAULT_GENERATOR_OPTIONS.shortBreakMinutes,
  sessionMinutes: DEFAULT_GENERATOR_OPTIONS.workSessionMinutes,
  leisureMinutes: DEFAULT_GENERATOR_OPTIONS.leisureMinutes,
  shortLeisureBlockMinutes: DEFAULT_GENERATOR_OPTIONS.shortLeisureBlockMinutes,
  maxLeisureBlockMinutes: DEFAULT_GENERATOR_OPTIONS.maxLeisureBlockMinutes,
};

export const WEEKEND_PLANNING_PROFILE: PlanningProfile = {
  gapMinutes: DEFAULT_GENERATOR_OPTIONS.shortBreakMinutes,
  sessionMinutes: DEFAULT_GENERATOR_OPTIONS.workSessionMinutes,
  leisureMinutes: DEFAULT_GENERATOR_OPTIONS.leisureMinutes,
  shortLeisureBlockMinutes: DEFAULT_GENERATOR_OPTIONS.shortLeisureBlockMinutes,
  maxLeisureBlockMinutes: DEFAULT_GENERATOR_OPTIONS.maxLeisureBlockMinutes,
};

const tierOrder: CandidateTier[] = ['OVERDUE', 'DUE_SOON', 'IMPORTANT', 'FILLER'];

// Size 1 is the smallest, 5 the longest, 0 unknown.
const LEAD_TIME_BY_SIZE: Record<number, number> = { 0: 3, 1: 1, 2: 2, 3: 4, 4: 7, 5: 14 };

export function defaultLeadTimeDays(size: number, priority: number) {
  return (LEAD_TIME_BY_SIZE[size] ?? 4) + (priority === 1 ? 2 : 0);
}

export function classifyCandidate({
  priority,
  size,
  daysUntilDue,
  leadTimeDays,
}: {
  priority: number;
  size: number;
  daysUntilDue: number | null;
  leadTimeDays: number;
}): CandidateTier {
  if (daysUntilDue !== null && daysUntilDue < 0) return 'OVERDUE';
  if (daysUntilDue !== null && daysUntilDue <= leadTimeDays) return 'DUE_SOON';
  if (priority <= 2 || (size >= 4 && size <= 5)) return 'IMPORTANT';
  return 'FILLER';
}

export function compareCandidates(a: PlanningCandidate, b: PlanningCandidate) {
  return (
    tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier) ||
    (a.daysUntilDue ?? Number.POSITIVE_INFINITY) - (b.daysUntilDue ?? Number.POSITIVE_INFINITY) ||
    a.priority - b.priority ||
    b.size - a.size ||
    a.id.localeCompare(b.id)
  );
}

type PrioritizableTask = {
  id: string;
  title: string;
  priority: number;
  size: number;
  dueDate: Date | null;
  leadTimeDays: number | null;
};

// Orders tasks the way the draft generator would pick them; `today` is a UTC-midnight date.
export function sortTasksByPlanningPriority<T extends PrioritizableTask>(tasks: T[], today: Date): T[] {
  const ranked = tasks.map((task) => {
    const daysUntilDue = task.dueDate
      ? Math.floor((task.dueDate.getTime() - today.getTime()) / 86_400_000)
      : null;
    const candidate: PlanningCandidate = {
      id: task.id,
      title: task.title,
      priority: task.priority,
      size: task.size,
      tier: classifyCandidate({
        priority: task.priority,
        size: task.size,
        daysUntilDue,
        leadTimeDays: task.leadTimeDays ?? defaultLeadTimeDays(task.size, task.priority),
      }),
      daysUntilDue,
      dueAt: task.dueDate,
      durationMinutes: 0,
      category: 'WORK',
    };
    return { task, candidate };
  });
  return ranked.toSorted((a, b) => compareCandidates(a.candidate, b.candidate)).map(({ task }) => task);
}

function normalizeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  const sorted = intervals
    .filter(({ start, end }) => end.getTime() > start.getTime())
    .toSorted((a, b) => a.start.getTime() - b.start.getTime());
  const merged: TimeInterval[] = [];

  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.start.getTime() > previous.end.getTime()) {
      merged.push({ start: interval.start, end: interval.end });
    } else if (interval.end.getTime() > previous.end.getTime()) {
      previous.end = interval.end;
    }
  }

  return merged;
}

function subtractBusyIntervals(availability: TimeInterval[], busy: TimeInterval[]): TimeInterval[] {
  let free = normalizeIntervals(availability);
  const blocks = normalizeIntervals(busy);

  for (const block of blocks) {
    free = free.flatMap((window) => {
      if (
        block.end.getTime() <= window.start.getTime() ||
        block.start.getTime() >= window.end.getTime()
      ) {
        return [window];
      }

      const remaining: TimeInterval[] = [];
      if (block.start.getTime() > window.start.getTime()) {
        remaining.push({ start: window.start, end: block.start });
      }
      if (block.end.getTime() < window.end.getTime()) {
        remaining.push({ start: block.end, end: window.end });
      }
      return remaining;
    });
  }

  return free;
}

export function scheduleCandidates({
  candidates,
  availability,
  busy,
  profile,
  categorySlots = [],
}: {
  candidates: PlanningCandidate[];
  availability: TimeInterval[];
  busy: TimeInterval[];
  profile: PlanningProfile;
  categorySlots?: CategorySlot[];
}): DaySchedule {
  const freeWindows = subtractBusyIntervals(availability, [
    ...busy,
    ...categorySlots.map(({ start, end }) => ({ start, end })),
  ]);
  const leisure: ScheduledCandidate[] = [];
  const availableMinutes = freeWindows.reduce(
    (total, window) => total + Math.floor((window.end.getTime() - window.start.getTime()) / 60_000),
    0
  );
  const leisureTarget = Math.min(Math.max(0, profile.leisureMinutes), availableMinutes);
  const shortLeisureMinutes = Math.min(
    profile.shortLeisureBlockMinutes,
    profile.maxLeisureBlockMinutes
  );
  const maxLeisureMinutes = Math.max(
    profile.shortLeisureBlockMinutes,
    profile.maxLeisureBlockMinutes
  );
  const averageLeisureBlockMinutes = (shortLeisureMinutes + maxLeisureMinutes) / 2;
  const minimumCount = leisureTarget ? Math.ceil(leisureTarget / maxLeisureMinutes) : 0;
  const maximumCount = leisureTarget
    ? Math.max(minimumCount, Math.floor(leisureTarget / shortLeisureMinutes))
    : 0;
  const leisureCount = Math.max(
    minimumCount,
    Math.min(maximumCount, Math.round(leisureTarget / averageLeisureBlockMinutes))
  );
  const leisureDurations = Array.from({ length: leisureCount }, () =>
    Math.min(shortLeisureMinutes, leisureTarget)
  );
  let unallocatedLeisure = leisureTarget - leisureDurations.reduce((sum, duration) => sum + duration, 0);
  const allocationOrder = Array.from({ length: leisureCount }, (_, index) => index).sort(
    (a, b) => Math.min(a, leisureCount - 1 - a) - Math.min(b, leisureCount - 1 - b)
  );
  for (const index of allocationOrder) {
    const extra = Math.min(maxLeisureMinutes - leisureDurations[index], unallocatedLeisure);
    leisureDurations[index] += extra;
    unallocatedLeisure -= extra;
  }
  for (let index = 0; index < leisureCount; index += 1) {
    const durationMinutes = leisureDurations[index];
    const targetCenter = (availableMinutes * (index + 1)) / (leisureCount + 1);
    let cursorMinutes = 0;
    const slots = subtractBusyIntervals(freeWindows, leisure).flatMap((window) => {
      const windowMinutes = Math.floor((window.end.getTime() - window.start.getTime()) / 60_000);
      const windowOffset = cursorMinutes;
      cursorMinutes += windowMinutes;
      if (windowMinutes < durationMinutes) {
        return [];
      }
      const offset = Math.round(
        Math.max(
          0,
          Math.min(windowMinutes - durationMinutes, targetCenter - windowOffset - durationMinutes / 2)
        )
      );
      const start = new Date(window.start.getTime() + offset * 60_000);
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      return [{ start, end, distance: Math.abs(targetCenter - (windowOffset + offset + durationMinutes / 2)) }];
    });
    const slot = slots.toSorted((a, b) => a.distance - b.distance)[0];
    if (slot) {
      leisure.push({
        id: `leisure:${leisure.length}`,
        title: 'Leisure',
        priority: 5,
        size: 0,
        tier: 'FILLER',
        daysUntilDue: null,
        dueAt: null,
        durationMinutes,
        category: 'LEISURE',
        start: slot.start,
        end: slot.end,
      });
    }
  }
  const workWindows = subtractBusyIntervals(freeWindows, leisure);
  const scheduled: ScheduledCandidate[] = [];
  const scheduledWork: ScheduledCandidate[] = [];
  const breaks: ScheduledCandidate[] = [];
  const reservations: ScheduledCandidate[] = [];
  const remainingByCandidate = new Map(
    candidates.map((candidate) => [candidate.id, candidate.durationMinutes])
  );
  const orderedCandidates = [...candidates].toSorted(compareCandidates);
  const allCategorySlots: CategorySlot[] = [
    ...categorySlots,
    ...leisure.map((block) => ({
      id: block.id,
      category: 'LEISURE' as const,
      start: block.start,
      end: block.end,
    })),
  ].toSorted((a, b) => a.start.getTime() - b.start.getTime());

  for (const slot of allCategorySlots) {
    const openWindows = subtractBusyIntervals(
      [{ start: slot.start, end: slot.end }],
      busy
    );
    const sessionLimit =
      slot.category === 'LEISURE'
        ? profile.maxLeisureBlockMinutes
        : profile.sessionMinutes;

    for (const openWindow of openWindows) {
      let cursor = openWindow.start.getTime();
      let continuousMinutes = 0;
      const windowEnd = openWindow.end.getTime();
      while (cursor < windowEnd) {
        const candidate = orderedCandidates.find(
          (item) =>
            item.category === slot.category &&
            (remainingByCandidate.get(item.id) ?? 0) > 0 &&
            item.durationMinutes > 0
        );
        if (!candidate) {
          break;
        }

        if (continuousMinutes >= sessionLimit) {
          const breakMinutes = Math.max(0, profile.gapMinutes);
          const breakEnd = cursor + breakMinutes * 60_000;
          if (breakEnd + 60_000 > windowEnd) {
            break;
          }
          const start = new Date(cursor);
          const end = new Date(breakEnd);
          breaks.push({
            id: `break:${breaks.length}`,
            title: 'Short break',
            priority: 5,
            size: 0,
            tier: 'FILLER',
            daysUntilDue: null,
            dueAt: null,
            durationMinutes: breakMinutes,
            category: 'REST',
            start,
            end,
          });
          cursor = breakEnd;
          continuousMinutes = 0;
        }

        const durationMinutes = Math.min(
          Math.floor((windowEnd - cursor) / 60_000),
          sessionLimit - continuousMinutes,
          remainingByCandidate.get(candidate.id) ?? 0
        );
        if (durationMinutes <= 0) {
          break;
        }
        const start = new Date(cursor);
        const end = new Date(cursor + durationMinutes * 60_000);
        scheduled.push({ ...candidate, durationMinutes, start, end });
        remainingByCandidate.set(
          candidate.id,
          (remainingByCandidate.get(candidate.id) ?? 0) - durationMinutes
        );
        cursor = end.getTime();
        continuousMinutes += durationMinutes;
      }
    }

    const assigned = scheduled
      .filter((block) =>
        orderedCandidates.some(
          (candidate) => candidate.id === block.id && candidate.category === slot.category
        )
      )
      .map(({ start, end }) => ({ start, end }));
    const scheduledBreaks = breaks.map(({ start, end }) => ({ start, end }));
    const unused = subtractBusyIntervals(
      [{ start: slot.start, end: slot.end }],
      [...busy, ...assigned, ...scheduledBreaks]
    );
    for (const [index, interval] of unused.entries()) {
      const durationMinutes = Math.floor((interval.end.getTime() - interval.start.getTime()) / 60_000);
      if (durationMinutes <= 0) {
        continue;
      }
      reservations.push({
        id: `reservation:${slot.id}:${index}`,
        title: slot.category === 'LEISURE' ? 'Leisure' : slot.category,
        priority: 5,
        size: 0,
        tier: 'FILLER',
        daysUntilDue: null,
        dueAt: null,
        durationMinutes,
        category: slot.category,
        start: interval.start,
        end: interval.end,
      });
    }
  }

  const eligible = candidates
    .filter(
      (candidate) =>
        candidate.category !== 'LEISURE' &&
        !allCategorySlots.some((slot) => slot.category === candidate.category)
    )
    .filter((candidate) => candidate.durationMinutes > 0)
    .toSorted(compareCandidates);
  const unscheduled: UnscheduledCandidate[] = candidates
    .filter((candidate) => candidate.durationMinutes <= 0)
    .map((candidate) => ({ candidate, reason: 'invalid-duration' }));
  for (const candidate of eligible) {
    let remaining = remainingByCandidate.get(candidate.id) ?? 0;
    while (remaining > 0) {
      const requestedMinutes = Math.min(remaining, profile.sessionMinutes);
      const last = scheduledWork.at(-1);
      const breakMinutes = last ? Math.max(0, profile.gapMinutes) : 0;
      let cursor = last?.end.getTime() ?? Number.NEGATIVE_INFINITY;
      let scheduledBreak: ScheduledCandidate | null = null;

      if (last && breakMinutes > 0) {
        cursor += breakMinutes * 60_000;
        const adjacentWindow = workWindows.find(
          (window) =>
            window.start.getTime() <= last.end.getTime() &&
            cursor <= window.end.getTime()
        );
        if (adjacentWindow) {
          const start = new Date(last.end);
          const end = new Date(cursor);
          scheduledBreak = {
            id: `break:${breaks.length}`,
            title: 'Short break',
            priority: 5,
            size: 0,
            tier: 'FILLER',
            daysUntilDue: null,
            dueAt: null,
            durationMinutes: breakMinutes,
            category: 'REST',
            start,
            end,
          };
        }
      }

      const possibleSlots = workWindows
        .map((window) => {
          const start = Math.max(window.start.getTime(), cursor);
          return {
            start,
            availableMinutes: Math.floor((window.end.getTime() - start) / 60_000),
          };
        })
        .filter(({ availableMinutes }) => availableMinutes > 0);
      const slot =
        candidate.durationMinutes > profile.sessionMinutes
          ? possibleSlots[0]
          : possibleSlots.find(({ availableMinutes }) => availableMinutes >= requestedMinutes);
      if (!slot) {
        unscheduled.push({ candidate, reason: 'no-available-slot' });
        break;
      }

      const durationMinutes = Math.min(requestedMinutes, slot.availableMinutes);
      if (scheduledBreak) {
        breaks.push(scheduledBreak);
      }
      const start = new Date(slot.start);
      const durationMs = durationMinutes * 60_000;
      const end = new Date(start.getTime() + durationMs);
      scheduled.push({ ...candidate, durationMinutes, start, end });
      scheduledWork.push({ ...candidate, durationMinutes, start, end });
      remaining -= durationMinutes;
      remainingByCandidate.set(candidate.id, remaining);
    }
  }

  for (const candidate of candidates) {
    if (
      (candidate.category === 'LEISURE' ||
        allCategorySlots.some((slot) => slot.category === candidate.category)) &&
      (remainingByCandidate.get(candidate.id) ?? 0) > 0 &&
      !unscheduled.some(({ candidate: item }) => item.id === candidate.id)
    ) {
      unscheduled.push({ candidate, reason: 'no-available-slot' });
    }
  }

  return { scheduled, breaks, leisure, reservations, unscheduled, freeWindows: workWindows };
}
