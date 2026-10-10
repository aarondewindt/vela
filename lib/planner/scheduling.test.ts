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
  category: 'WORK',
  ...overrides,
});

const noLeisureProfile = { ...WEEKDAY_PLANNING_PROFILE, leisureMinutes: 0 };

describe('scheduleCandidates', () => {
  it('orders by tier then due proximity without a daily block quota', () => {
    const result = scheduleCandidates({
      candidates: [
        candidate({ id: 'filler', tier: 'FILLER' }),
        candidate({ id: 'soon-late', tier: 'DUE_SOON', daysUntilDue: 3 }),
        candidate({ id: 'overdue', tier: 'OVERDUE', daysUntilDue: -1 }),
        candidate({ id: 'soon-early', tier: 'DUE_SOON', daysUntilDue: 1 }),
        candidate({ id: 'also-filler', tier: 'FILLER' }),
      ],
      availability: [{ start: at(9), end: at(15) }],
      busy: [],
      profile: WEEKDAY_PLANNING_PROFILE,
    });

    expect(result.scheduled.map(({ id }) => id)).toEqual([
      'overdue',
      'soon-early',
      'soon-late',
      'also-filler',
      'filler',
    ]);
    expect(result.unscheduled).toEqual([]);
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
      profile: { ...noLeisureProfile, gapMinutes: 15 },
    });

    expect(result.scheduled.map(({ start, end }) => [start, end])).toEqual([
      [at(10, 30), at(11, 15)],
      [at(11, 30), at(12)],
    ]);
    expect(result.breaks.map(({ start, end }) => [start, end])).toEqual([[at(11, 15), at(11, 30)]]);
    expect(result.freeWindows).toEqual([
      { start: at(9), end: at(9, 30) },
      { start: at(10, 30), end: at(12) },
    ]);
  });

  it('schedules partial work when the full estimate cannot fit', () => {
    const result = scheduleCandidates({
      candidates: [
        candidate({ id: 'too-long', durationMinutes: 120 }),
        candidate({ id: 'invalid', durationMinutes: 0 }),
        candidate({ id: 'other', tier: 'FILLER' }),
      ],
      availability: [{ start: at(9), end: at(10) }],
      busy: [],
      profile: noLeisureProfile,
    });

    expect(result.scheduled.map(({ id, durationMinutes }) => [id, durationMinutes])).toEqual([
      ['too-long', 60],
    ]);
    expect(result.unscheduled.map(({ candidate: item, reason }) => [item.id, reason])).toEqual([
      ['invalid', 'invalid-duration'],
      ['too-long', 'no-available-slot'],
      ['other', 'no-available-slot'],
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
      profile: noLeisureProfile,
    });

    expect(result.scheduled[0]).toMatchObject({ start: at(11), end: at(11, 45) });
    expect(result.freeWindows).toEqual([
      { start: at(9), end: at(9, 30) },
      { start: at(11), end: at(12) },
    ]);
  });

  it('splits long candidates into sessions with explicit rests and reserves leisure', () => {
    const result = scheduleCandidates({
      candidates: [candidate({ durationMinutes: 180 })],
      availability: [{ start: at(9), end: at(14) }],
      busy: [],
      profile: {
        ...WEEKDAY_PLANNING_PROFILE,
        sessionMinutes: 90,
        gapMinutes: 15,
        shortLeisureBlockMinutes: 30,
        maxLeisureBlockMinutes: 30,
      },
    });

    expect(result.scheduled.map(({ durationMinutes, start, end }) => [durationMinutes, start, end])).toEqual([
      [85, at(9), at(10, 25)],
      [90, at(10, 55), at(12, 25)],
      [5, at(13, 5), at(13, 10)],
    ]);
    expect(result.breaks).toEqual([]);
    expect(result.leisure.map(({ category, start, end }) => [category, start, end])).toEqual([
      ['LEISURE', at(10, 25), at(10, 55)],
      ['LEISURE', at(12, 35), at(13, 5)],
    ]);
    expect(result.unscheduled).toHaveLength(0);
  });

  it('keeps reserved leisure within short availability', () => {
    const result = scheduleCandidates({
      candidates: [],
      availability: [{ start: at(9), end: at(9, 40) }],
      busy: [],
      profile: { ...WEEKDAY_PLANNING_PROFILE, leisureMinutes: 60 },
    });

    expect(result.leisure.map(({ start, end, durationMinutes }) => [start, end, durationMinutes])).toEqual([
      [at(9), at(9, 40), 40],
    ]);
  });

  it('distributes leisure across short and long blocks within configured bounds', () => {
    const result = scheduleCandidates({
      candidates: [],
      availability: [{ start: at(9), end: at(17) }],
      busy: [],
      profile: {
        ...WEEKDAY_PLANNING_PROFILE,
        leisureMinutes: 180,
        shortLeisureBlockMinutes: 30,
        maxLeisureBlockMinutes: 90,
      },
    });

    expect(result.leisure.map(({ durationMinutes }) => durationMinutes)).toEqual([90, 30, 60]);
    expect(result.leisure.reduce((total, block) => total + block.durationMinutes, 0)).toBe(180);
    expect(result.leisure.every(({ durationMinutes }) => durationMinutes >= 30 && durationMinutes <= 90)).toBe(true);
  });

  it('assigns leisure tasks to reserved leisure blocks', () => {
    const result = scheduleCandidates({
      candidates: [candidate({ id: 'hobby', title: 'Practice guitar', category: 'LEISURE' })],
      availability: [{ start: at(9), end: at(11) }],
      busy: [],
      profile: {
        ...WEEKDAY_PLANNING_PROFILE,
        leisureMinutes: 60,
        shortLeisureBlockMinutes: 60,
        maxLeisureBlockMinutes: 60,
      },
    });

    expect(result.scheduled).toEqual([
      expect.objectContaining({
        id: 'hobby',
        title: 'Practice guitar',
        category: 'LEISURE',
        durationMinutes: 30,
      }),
    ]);
    expect(result.reservations).toEqual([
      expect.objectContaining({
        category: 'LEISURE',
        title: 'Leisure',
        durationMinutes: 30,
      }),
    ]);
  });

  it('schedules ordinary tasks before a midday Leisure reservation', () => {
    const result = scheduleCandidates({
      candidates: [
        candidate({ id: 'hobby', category: 'LEISURE' }),
        candidate({ id: 'work', category: 'WORK' }),
      ],
      availability: [{ start: at(9), end: at(13) }],
      busy: [],
      profile: {
        ...WEEKDAY_PLANNING_PROFILE,
        leisureMinutes: 60,
        shortLeisureBlockMinutes: 60,
        maxLeisureBlockMinutes: 60,
      },
    });

    expect(result.scheduled.find(({ id }) => id === 'work')).toMatchObject({
      start: at(9),
      end: at(9, 30),
    });
    expect(result.scheduled.find(({ id }) => id === 'hobby')?.start).toEqual(at(10, 30));
  });

  it('packs multiple matching leisure tasks into one reserved leisure block', () => {
    const result = scheduleCandidates({
      candidates: [
        candidate({ id: 'guitar', title: 'Practice guitar', category: 'LEISURE' }),
        candidate({ id: 'reading', title: 'Read a book', category: 'LEISURE' }),
      ],
      availability: [{ start: at(9), end: at(11) }],
      busy: [],
      profile: {
        ...WEEKDAY_PLANNING_PROFILE,
        leisureMinutes: 60,
        shortLeisureBlockMinutes: 60,
        maxLeisureBlockMinutes: 60,
      },
    });

    expect(result.scheduled.map(({ id }) => id)).toEqual(['guitar', 'reading']);
    expect(result.reservations).toEqual([]);
  });

  it('uses manual category slots for matching candidates and preserves unmatched time', () => {
    const result = scheduleCandidates({
      candidates: [candidate({ id: 'chore', category: 'LIFE', durationMinutes: 30 })],
      availability: [{ start: at(9), end: at(11) }],
      busy: [],
      categorySlots: [{ id: 'life-slot', category: 'LIFE', start: at(9), end: at(10) }],
      profile: { ...WEEKDAY_PLANNING_PROFILE, leisureMinutes: 0 },
    });

    expect(result.scheduled[0]).toMatchObject({ id: 'chore', start: at(9), end: at(9, 30) });
    expect(result.reservations).toEqual([
      expect.objectContaining({
        category: 'LIFE',
        start: at(9, 30),
        end: at(10),
        durationMinutes: 30,
      }),
    ]);
  });

  it('keeps remaining category task effort inside its reserved category section', () => {
    const result = scheduleCandidates({
      candidates: [candidate({ id: 'long-chore', category: 'LIFE', durationMinutes: 60 })],
      availability: [{ start: at(9), end: at(11) }],
      busy: [],
      categorySlots: [{ id: 'life-slot', category: 'LIFE', start: at(9), end: at(9, 30) }],
      profile: { ...WEEKDAY_PLANNING_PROFILE, leisureMinutes: 0 },
    });

    expect(result.scheduled).toHaveLength(1);
    expect(result.scheduled[0]).toMatchObject({ start: at(9), end: at(9, 30) });
    expect(result.unscheduled.map(({ candidate: item }) => item.id)).toEqual(['long-chore']);
  });
});
