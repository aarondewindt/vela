import {
  projectCalorieBurn,
  localDayBounds,
  compatibleCalories,
  type CalorieRecord,
} from './calorie-projection';
import { calorieTimeline } from './calorie-timeline';
const date = '2026-01-01',
  timezone = 'UTC';
const total = (cutoff = '2026-01-01T12:00:00Z'): CalorieRecord => ({
  date,
  value: 1200,
  source: 'samsung_health',
  observedAt: new Date(cutoff),
  metadata: {
    measurementKind: 'sdk_aggregate_semantics_unverified',
    periodStart: '2026-01-01T00:00:00Z',
    periodEnd: cutoff,
    timezone,
    credentialId: 'phone',
  },
});
const bmr: CalorieRecord = {
  date: '2025-12-30',
  value: 1800,
  source: 'samsung_health',
  metadata: { measurementKind: 'sdk_bmr_point', sourceObservedAt: '2025-12-30T12:00:00Z' },
};
const run = (extra = {}) =>
  projectCalorieBurn({
    date,
    timezone,
    total: total(),
    bmr,
    now: new Date('2026-01-01T18:00:00Z'),
    ...extra,
  });
it.each([
  ['00:01', 1 / 1440],
  ['06:00', 0.25],
  ['12:00', 0.5],
  ['23:59', 1439 / 1440],
])('adds only remaining BMR at %s', (time, fraction) => {
  const result = run({
    total: total(`2026-01-01T${time}:00Z`),
    now: new Date('2026-01-01T23:59:59Z'),
  }).projection!;
  expect(result.projectedTotal).toBeCloseTo(1200 + 1800 * (1 - fraction));
});
it('uses cutoff rather than delayed receipt or server time and preserves provenance', () => {
  const delayed = { ...total(), observedAt: new Date('2026-01-01T15:00:00Z') };
  expect(run({ total: delayed }).projection).toMatchObject({
    projectedTotal: 2100,
    cutoff: '2026-01-01T12:00:00.000Z',
    capturedAt: '2026-01-01T15:00:00.000Z',
    ageMinutes: 360,
    bmrObservedAt: '2025-12-30T12:00:00.000Z',
  });
});
it.each([
  { total: null },
  { bmr: null },
  { total: { ...total(), source: 'manual' } },
  { total: { ...total(), value: NaN } },
  { bmr: { ...bmr, value: 0 } },
  { timezone: 'Europe/Amsterdam' },
  { now: new Date('2026-01-02T00:00:00Z') },
  { total: total('2026-01-01T20:00:00Z') },
  {
    total: {
      ...total(),
      metadata: { ...(total().metadata as object), calorieSemantics: 'full_day_resting' },
    },
  },
  {
    bmr: {
      ...bmr,
      metadata: { ...(bmr.metadata as object), sourceObservedAt: '2026-01-01T15:00:00Z' },
    },
  },
])('does not project missing, incompatible or future values %j', (extra) =>
  expect(run(extra).projection).toBeNull()
);
it.each([
  ['2026-03-29', '2026-03-28T23:00:00Z', '2026-03-29T22:00:00Z', 23],
  ['2026-10-25', '2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z', 25],
])('uses the actual local day length on %s', (day, start, end, hours) => {
  const bounds = localDayBounds(day, 'Europe/Amsterdam');
  expect(bounds).toEqual({ start: Date.parse(start), end: Date.parse(end) });
  const cutoff = new Date(bounds.start + (hours * 3600000) / 2);
  const t = {
    ...total(),
    date: day,
    observedAt: cutoff,
    metadata: {
      ...(total().metadata as object),
      timezone: 'Europe/Amsterdam',
      periodStart: start,
      periodEnd: cutoff.toISOString(),
    },
  };
  expect(
    run({ date: day, timezone: 'Europe/Amsterdam', total: t, now: cutoff }).projection
      ?.projectedTotal
  ).toBe(2100);
});
it('does not add BMR at the completed day boundary', () => {
  // A past day is no longer projected, even when its final capture arrives after midnight.
  expect(
    run({ total: total('2026-01-02T00:00:00Z'), now: new Date('2026-01-02T01:00:00Z') }).projection
  ).toBeNull();
});
it('requires matching intervals and origins for decomposition', () => {
  expect(compatibleCalories(total(), total())).toBe(true);
  expect(compatibleCalories(total(), total('2026-01-01T11:00:00Z'))).toBe(false);
});
it('retains sparse captures, applies downward revisions and uses the same projection endpoint', () => {
  const a = { ...total('2026-01-01T06:00:00Z'), metric: 'TOTAL_CALORIES', value: 600 };
  const t = { ...total(), metric: 'TOTAL_CALORIES' };
  const revised = { ...t, value: 1100, observedAt: new Date('2026-01-01T13:00:00Z') };
  const active = { ...t, metric: 'ACTIVE_CALORIES', value: 200 };
  const timeline = calorieTimeline(
    date,
    timezone,
    [t, active, a, revised],
    [revised, { ...bmr, metric: 'BMR' }],
    new Date('2026-01-01T18:00:00Z')
  );
  expect(timeline.points).toHaveLength(3);
  expect(timeline.points[1]).toMatchObject({
    total: 1100,
    active: 200,
    resting: 900,
    projected: 1100,
  });
  expect(timeline.points[2]).toMatchObject({ total: null, projected: 2000 });
  expect(timeline.projection?.projectedTotal).toBe(
    run({ total: revised }).projection?.projectedTotal
  );
});
