import { scheduleCandidates, WEEKDAY_PLANNING_PROFILE, type PlanningCandidate } from './scheduling';

// UTC instants make these fixtures independent of the test process timezone.
const at = (time: string) => new Date(`2026-10-19T${time}:00Z`);
const task = (
  id: string,
  durationMinutes: number,
  category: PlanningCandidate['category'] = 'WORK'
): PlanningCandidate => ({
  id,
  title: id,
  durationMinutes,
  category,
  priority: 3,
  size: 3,
  tier: 'IMPORTANT',
  daysUntilDue: null,
  dueAt: null,
});
const profile = { ...WEEKDAY_PLANNING_PROFILE, leisureMinutes: 0 };
const fixtures = [
  {
    name: 'adjacent half-open calendar boundary',
    candidates: [task('task', 30)],
    busy: [{ start: at('09:00'), end: at('10:00') }],
    expectedMinutes: 30,
  },
  {
    name: 'overloaded day with explicit unfinished work',
    candidates: [task('task', 240)],
    busy: [],
    expectedMinutes: 105,
  },
  {
    name: 'matching category reservation',
    candidates: [task('chore', 30, 'LIFE')],
    busy: [],
    categorySlots: [
      { id: 'life', category: 'LIFE' as const, start: at('09:00'), end: at('10:00') },
    ],
    expectedMinutes: 30,
  },
  {
    name: 'leisure cannot consume unreserved work time',
    candidates: [task('hobby', 30, 'LEISURE')],
    busy: [],
    expectedMinutes: 0,
  },
];

describe('preserved placement constraints (#31)', () => {
  it.each(fixtures)('$name', ({ candidates, busy, categorySlots, expectedMinutes }) => {
    const start = at('09:00');
    const end = at('11:00');
    const result = scheduleCandidates({
      candidates,
      availability: [{ start, end }],
      busy,
      categorySlots,
      profile,
    });
    const allocations = [...result.scheduled, ...result.breaks, ...result.reservations].toSorted(
      (a, b) => a.start.getTime() - b.start.getTime()
    );
    for (const [index, allocation] of allocations.entries()) {
      expect(allocation.start.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(allocation.end.getTime()).toBeLessThanOrEqual(end.getTime());
      expect(allocation.durationMinutes).toBeGreaterThan(0);
      expect(allocation.end.getTime() - allocation.start.getTime()).toBe(
        allocation.durationMinutes * 60_000
      );
      for (const blocked of busy) {
        expect(allocation.end <= blocked.start || allocation.start >= blocked.end).toBe(true);
      }
      expect(allocations[index - 1]?.end.getTime() ?? start.getTime()).toBeLessThanOrEqual(
        allocation.start.getTime()
      );
    }
    expect(result.scheduled.reduce((sum, item) => sum + item.durationMinutes, 0)).toBe(
      expectedMinutes
    );
    for (const candidate of candidates) {
      const allocated = result.scheduled
        .filter(({ id }) => id === candidate.id)
        .reduce((sum, item) => sum + item.durationMinutes, 0);
      expect(allocated).toBeLessThanOrEqual(candidate.durationMinutes);
      expect(
        result.unscheduled.some(
          ({ candidate: item, reason }) =>
            item.id === candidate.id && reason === 'no-available-slot'
        )
      ).toBe(allocated < candidate.durationMinutes);
    }
  });
});

describe('legacy behavior intentionally replaced by #11/#33/#34', () => {
  it('currently splits 60 + 45 minutes at the exact session cap inside a category slot', () => {
    const result = scheduleCandidates({
      candidates: [task('a', 60), task('b', 45)],
      availability: [{ start: at('09:00'), end: at('12:00') }],
      busy: [],
      profile,
      categorySlots: [{ id: 'work', category: 'WORK', start: at('09:00'), end: at('12:00') }],
    });
    expect(result.scheduled.map(({ id, durationMinutes }) => [id, durationMinutes])).toEqual([
      ['a', 60],
      ['b', 30],
      ['b', 15],
    ]);
    expect(result.breaks.map(({ start, end }) => [start, end])).toEqual([
      [at('10:30'), at('10:45')],
    ]);
    // The replacement should keep b intact and finish at 10:45 using the bounded extension.
  });

  it('currently lets an explicit category slot generate work outside availability', () => {
    const result = scheduleCandidates({
      candidates: [task('chore', 30, 'LIFE')],
      availability: [],
      busy: [],
      profile,
      categorySlots: [{ id: 'life', category: 'LIFE', start: at('09:00'), end: at('10:00') }],
    });
    expect(result.scheduled[0]).toMatchObject({
      id: 'chore',
      start: at('09:00'),
      end: at('09:30'),
    });
    // This is a documented legacy gap, not permission for the replacement to bypass availability.
  });
});
