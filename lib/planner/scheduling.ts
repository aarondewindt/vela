export type CandidateTier = 'OVERDUE' | 'DUE_SOON' | 'IMPORTANT' | 'FILLER';

export type PlanningCandidate = {
  id: string;
  title: string;
  priority: number;
  size: number;
  tier: CandidateTier;
  daysUntilDue: number | null;
  dueAt: Date | null;
  durationMinutes: number;
};

export type TimeInterval = {
  start: Date;
  end: Date;
};

export type PlanningProfile = {
  maxBlocks: number;
  gapMinutes: number;
};

export type ScheduledCandidate = PlanningCandidate & TimeInterval;

export type UnscheduledCandidate = {
  candidate: PlanningCandidate;
  reason: 'quota' | 'invalid-duration' | 'no-available-slot';
};

export type DaySchedule = {
  scheduled: ScheduledCandidate[];
  unscheduled: UnscheduledCandidate[];
  freeWindows: TimeInterval[];
};

export const WEEKDAY_PLANNING_PROFILE: PlanningProfile = {
  maxBlocks: 3,
  gapMinutes: 15,
};

export const WEEKEND_PLANNING_PROFILE: PlanningProfile = {
  maxBlocks: 5,
  gapMinutes: 15,
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

function compareCandidates(a: PlanningCandidate, b: PlanningCandidate) {
  return (
    tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier) ||
    (a.daysUntilDue ?? Number.POSITIVE_INFINITY) - (b.daysUntilDue ?? Number.POSITIVE_INFINITY) ||
    a.priority - b.priority ||
    b.size - a.size ||
    a.id.localeCompare(b.id)
  );
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
}: {
  candidates: PlanningCandidate[];
  availability: TimeInterval[];
  busy: TimeInterval[];
  profile: PlanningProfile;
}): DaySchedule {
  const freeWindows = subtractBusyIntervals(availability, busy);
  const eligible = candidates
    .filter((candidate) => candidate.durationMinutes > 0)
    .toSorted(compareCandidates);
  const scheduled: ScheduledCandidate[] = [];
  const unscheduled: UnscheduledCandidate[] = candidates
    .filter((candidate) => candidate.durationMinutes <= 0)
    .map((candidate) => ({ candidate, reason: 'invalid-duration' }));

  for (const candidate of eligible) {
    if (scheduled.length >= profile.maxBlocks) {
      unscheduled.push({ candidate, reason: 'quota' });
      continue;
    }
    const durationMs = candidate.durationMinutes * 60_000;
    const cursor = scheduled.length
      ? scheduled[scheduled.length - 1].end.getTime() + profile.gapMinutes * 60_000
      : Number.NEGATIVE_INFINITY;
    const slot = freeWindows.find((window) => {
      const start = Math.max(window.start.getTime(), cursor);
      return start + durationMs <= window.end.getTime();
    });

    if (!slot) {
      unscheduled.push({ candidate, reason: 'no-available-slot' });
      continue;
    }

    const start = new Date(Math.max(slot.start.getTime(), cursor));
    const end = new Date(start.getTime() + durationMs);
    scheduled.push({ ...candidate, start, end });
  }

  return { scheduled, unscheduled, freeWindows };
}
