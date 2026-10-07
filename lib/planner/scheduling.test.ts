import { scheduleCandidates, WEEKDAY_PLANNING_PROFILE, type PlanningCandidate } from './scheduling';

const at = (hour: number, minute = 0) => new Date(2026, 0, 5, hour, minute);

const candidate = (overrides: Partial<PlanningCandidate> = {}): PlanningCandidate => ({
  id: 'task-1',
  title: 'Task',
  priority: 3,
  tier: 'P2',
  dueAt: null,
  durationMinutes: 30,
  ...overrides,
});

describe('scheduleCandidates', () => {
  it('uses quota tiers and returns a reason for candidates outside the quota', () => {
    const result = scheduleCandidates({
      candidates: [
        candidate({ id: 'p2-a', tier: 'P2' }),
        candidate({ id: 'p1', tier: 'P1' }),
        candidate({ id: 'p2-b', tier: 'P2' }),
        candidate({ id: 'p2-c', tier: 'P2' }),
      ],
      availability: [{ start: at(9), end: at(14) }],
      busy: [],
      profile: WEEKDAY_PLANNING_PROFILE,
    });

    expect(result.scheduled.map(({ id }) => id)).toEqual(['p1', 'p2-a', 'p2-b']);
    expect(result.unscheduled).toEqual([
      { candidate: expect.objectContaining({ id: 'p2-c' }), reason: 'quota' },
    ]);
  });

  it('places candidates around busy time and enforces the inter-task gap', () => {
    const result = scheduleCandidates({
      candidates: [
        candidate({ durationMinutes: 45 }),
        candidate({ id: 'task-2', durationMinutes: 30 }),
      ],
      availability: [{ start: at(9), end: at(12) }],
      busy: [{ start: at(9, 30), end: at(10, 30) }],
      profile: { ...WEEKDAY_PLANNING_PROFILE, gapMinutes: 15 },
    });

    expect(result.scheduled.map(({ start, end }) => [start, end])).toEqual([
      [at(10, 30), at(11, 15)],
      [at(11, 30), at(12)],
    ]);
    expect(result.freeWindows).toEqual([
      { start: at(9), end: at(9, 30) },
      { start: at(10, 30), end: at(12) },
    ]);
  });

  it('reports tasks that do not fit, invalid durations, and candidates without quota', () => {
    const result = scheduleCandidates({
      candidates: [
        candidate({ id: 'too-long', durationMinutes: 120 }),
        candidate({ id: 'invalid', durationMinutes: 0 }),
        candidate({ id: 'other', tier: 'OTHER' }),
      ],
      availability: [{ start: at(9), end: at(10) }],
      busy: [],
      profile: { ...WEEKDAY_PLANNING_PROFILE, maxBlocks: 1 },
    });

    expect(result.unscheduled.map(({ candidate: item, reason }) => [item.id, reason])).toEqual([
      ['invalid', 'invalid-duration'],
      ['too-long', 'no-available-slot'],
      ['other', 'quota'],
    ]);
  });

  it('normalizes overlapping availability and busy intervals', () => {
    const result = scheduleCandidates({
      candidates: [candidate({ durationMinutes: 45 })],
      availability: [
        { start: at(9), end: at(11) },
        { start: at(10), end: at(12) },
      ],
      busy: [
        { start: at(9, 30), end: at(10, 30) },
        { start: at(10), end: at(11) },
      ],
      profile: WEEKDAY_PLANNING_PROFILE,
    });

    expect(result.scheduled[0]).toMatchObject({ start: at(11), end: at(11, 45) });
    expect(result.freeWindows).toEqual([
      { start: at(9), end: at(9, 30) },
      { start: at(11), end: at(12) },
    ]);
  });
});
