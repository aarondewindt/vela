export type CandidateTier = 'P1' | 'P2' | 'XS' | 'OTHER';

export type PlanningCandidate = {
  id: string;
  title: string;
  priority: number;
  tier: CandidateTier;
  dueAt: Date | null;
  durationMinutes: number;
};

export type TimeInterval = {
  start: Date;
  end: Date;
};

export type PlanningProfile = {
  maxBlocks: number;
  limits: Record<Exclude<CandidateTier, 'OTHER'>, number>;
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
  limits: { P1: 1, P2: 2, XS: 2 },
  maxBlocks: 3,
  gapMinutes: 15,
};

export const WEEKEND_PLANNING_PROFILE: PlanningProfile = {
  limits: { P1: 2, P2: 3, XS: 3 },
  maxBlocks: 5,
  gapMinutes: 15,
};

const tierOrder: CandidateTier[] = ['P1', 'P2', 'XS', 'OTHER'];

function compareCandidates(a: PlanningCandidate, b: PlanningCandidate) {
  const dueDifference =
    (a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) -
    (b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY);
  return dueDifference || a.priority - b.priority || a.id.localeCompare(b.id);
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

function selectCandidates(candidates: PlanningCandidate[], profile: PlanningProfile) {
  const eligible = candidates.filter((candidate) => candidate.durationMinutes > 0);
  const selected: PlanningCandidate[] = [];
  const selectedIds = new Set<string>();

  for (const tier of tierOrder) {
    const tierCandidates = eligible
      .filter((candidate) => candidate.tier === tier)
      .toSorted(compareCandidates);
    const limit = tier === 'OTHER' ? profile.maxBlocks : profile.limits[tier];

    for (const candidate of tierCandidates) {
      if (selected.length >= profile.maxBlocks) {
        break;
      }
      if (selected.filter((item) => item.tier === tier).length >= limit) {
        break;
      }
      selected.push(candidate);
      selectedIds.add(candidate.id);
    }
  }

  return { eligible, selected: selected.toSorted(compareCandidates), selectedIds };
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
  const { eligible, selected, selectedIds } = selectCandidates(candidates, profile);
  const scheduled: ScheduledCandidate[] = [];
  const unscheduled: UnscheduledCandidate[] = candidates
    .filter((candidate) => candidate.durationMinutes <= 0)
    .map((candidate) => ({ candidate, reason: 'invalid-duration' }));

  for (const candidate of selected) {
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

  unscheduled.push(
    ...eligible
      .filter((candidate) => !selectedIds.has(candidate.id))
      .map((candidate) => ({ candidate, reason: 'quota' as const }))
  );

  return { scheduled, unscheduled, freeWindows };
}
