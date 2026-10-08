import {
  classifyCandidate,
  scheduleCandidates,
  WEEKDAY_PLANNING_PROFILE,
  type PlanningCandidate,
} from './scheduling';

const at = (hour: number, minute = 0) => new Date(2026, 0, 5, hour, minute);

const candidate = (overrides: Partial<PlanningCandidate> = {}): PlanningCandidate => ({
  id: 'task-1',
  title: 'Task',
  priority: 3,
  size: 3,
  tier: 'IMPORTANT',
  daysUntilDue: null,
  dueAt: null,
  durationMinutes: 30,
  ...overrides,
});

describe('scheduleCandidates', () => {
  it('orders by tier then due proximity and reports candidates beyond maxBlocks', () => {
    const result = scheduleCandidates({
      candidates: [
        candidate({ id: 'filler', tier: 'FILLER' }),
        candidate({ id: 'soon-late', tier: 'DUE_SOON', daysUntilDue: 3 }),
        candidate({ id: 'overdue', tier: 'OVERDUE', daysUntilDue: -1 }),
        candidate({ id: 'soon-early', tier: 'DUE_SOON', daysUntilDue: 1 }),
      ],
      availability: [{ start: at(9), end: at(14) }],
      busy: [],
      profile: WEEKDAY_PLANNING_PROFILE,
    });

    expect(result.scheduled.map(({ id }) => id)).toEqual(['overdue', 'soon-early', 'soon-late']);
    expect(result.unscheduled).toEqual([
      { candidate: expect.objectContaining({ id: 'filler' }), reason: 'quota' },
    ]);
  });

  it('classifies by due proximity, importance, and size', () => {
    const base = { priority: 3, size: 3, daysUntilDue: null, leadTimeDays: 4 };
    expect(classifyCandidate({ ...base, daysUntilDue: -1 })).toBe('OVERDUE');
    expect(classifyCandidate({ ...base, daysUntilDue: 4 })).toBe('DUE_SOON');
    expect(classifyCandidate({ ...base, daysUntilDue: 5 })).toBe('FILLER');
    expect(classifyCandidate({ ...base, priority: 1 })).toBe('IMPORTANT');
    expect(classifyCandidate({ ...base, size: 5 })).toBe('IMPORTANT');
    expect(classifyCandidate({ ...base, size: 0 })).toBe('FILLER');
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

  it('reports tasks that do not fit and invalid durations, then fills with later candidates', () => {
    const result = scheduleCandidates({
      candidates: [
        candidate({ id: 'too-long', durationMinutes: 120 }),
        candidate({ id: 'invalid', durationMinutes: 0 }),
        candidate({ id: 'other', tier: 'FILLER' }),
      ],
      availability: [{ start: at(9), end: at(10) }],
      busy: [],
      profile: { ...WEEKDAY_PLANNING_PROFILE, maxBlocks: 1 },
    });

    expect(result.unscheduled.map(({ candidate: item, reason }) => [item.id, reason])).toEqual([
      ['invalid', 'invalid-duration'],
      ['too-long', 'no-available-slot'],
    ]);
    expect(result.scheduled.map(({ id }) => id)).toEqual(['other']);
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
