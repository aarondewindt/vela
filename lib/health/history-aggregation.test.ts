import { aggregateHealthHistory, splitCalories, type HistoryRecord } from './history-aggregation';
import { shiftDiaryDate } from '@/lib/nutrition/dates';

const record = (
  metric: HistoryRecord['metric'],
  value: number,
  date = '2026-01-01',
  extra = {}
): HistoryRecord => ({ date, metric, value, source: 'manual', ...extra });
const aggregate = (
  records: HistoryRecord[],
  nutrition: { date: string; calories: number }[] = []
) => aggregateHealthHistory('2026-01-01', '2026-01-03', '2026-01-03', records, nutrition).points;

it('keeps measured zero distinct from missing and never treats active calories as total', () => {
  const points = aggregate(
    [record('TOTAL_CALORIES', 0), record('ACTIVE_CALORIES', 300, '2026-01-02')],
    [{ date: '2026-01-01', calories: 0 }]
  );
  expect(points[0]).toMatchObject({
    total: 0,
    unsplit: 0,
    active: null,
    resting: null,
    balance: 0,
  });
  expect(points[1]).toMatchObject({ total: null, balance: null });
  expect(points[2]).toMatchObject({ total: null, balance: null, provisional: true });
});

it('decomposes known SDK intervals and rejects mismatched, missing or invalid readings', () => {
  expect(splitCalories(2400, 400, true)).toEqual({ active: 400, resting: 2000 });
  expect(splitCalories(0, 0, true)).toEqual({ active: 0, resting: 0 });
  for (const [total, active, compatible] of [
    [2400, 400, false],
    [100, 101, true],
    [0, -1, true],
    [NaN, 0, true],
    [2400, null, true],
  ] as const) {
    expect(splitCalories(total, active, compatible)).toBeNull();
  }
  const metadata = {
    measurementKind: 'sdk_aggregate_semantics_unverified',
    periodStart: '2026-01-01T00:00:00Z',
    periodEnd: '2026-01-02T00:00:00Z',
    timezone: 'UTC',
    credentialId: 'phone',
  };
  const records = [
    record('TOTAL_CALORIES', 2400, undefined, { source: 'samsung_health', metadata }),
    record('ACTIVE_CALORIES', 400, undefined, { source: 'samsung_health', metadata }),
  ];
  expect(aggregate(records)[0]).toMatchObject({
    total: 2400,
    unsplit: null,
    resting: 2000,
    active: 400,
  });
  const verified = { ...metadata, calorieSemantics: 'elapsed_expenditure' };
  expect(aggregate(records.map((r) => ({ ...r, metadata: verified })))[0]).toMatchObject({
    total: 2400,
    unsplit: null,
    resting: 2000,
    active: 400,
  });
  expect(
    aggregate(
      records.map((r) => ({
        ...r,
        metadata: {
          ...verified,
          periodEnd: r.metric === 'ACTIVE_CALORIES' ? '2026-01-01T12:00:00Z' : verified.periodEnd,
        },
      }))
    )[0].resting
  ).toBeNull();
});

it('sums balances with the existing sign and leaves incomplete periods as gaps', () => {
  const records = Array.from({ length: 120 }, (_, index) =>
    record('TOTAL_CALORIES', 2400, shiftDiaryDate('2026-01-01', index))
  );
  const intake = records.map((r) => ({ date: r.date, calories: 2000 }));
  const result = aggregateHealthHistory('2026-01-01', '2026-04-30', '2026-05-01', records, intake);
  expect(result.aggregation).toBe('weekly');
  for (const point of result.points) {
    expect(point.balance).toBe(-400 * point.expectedDays);
  }
  const missing = aggregateHealthHistory(
    '2026-01-01',
    '2026-04-30',
    '2026-05-01',
    records.slice(1),
    intake
  ).points[0];
  expect(missing.balance).toBeNull();
  expect(missing.total).toBe(2400 * (missing.expectedDays - 1));
  expect(missing.burnedDays).toBe(missing.expectedDays - 1);
});

it('requires full source-day coverage for Samsung historical balance, including a 25-hour day', () => {
  const make = (periodEnd: string) =>
    record('TOTAL_CALORIES', 2400, '2026-10-25', {
      source: 'samsung_health',
      metadata: { timezone: 'Europe/Amsterdam', periodEnd },
    });
  const run = (end: string) =>
    aggregateHealthHistory(
      '2026-10-25',
      '2026-10-25',
      '2026-10-26',
      [make(end)],
      [{ date: '2026-10-25', calories: 2000 }]
    ).points[0];
  expect(run('2026-10-25T23:00:00Z').balance).toBe(-400);
  expect(run('2026-10-25T12:00:00Z').balance).toBeNull();
  expect(run('2026-10-25T22:00:00Z').balance).toBeNull();
  expect(
    aggregate(
      [record('TOTAL_CALORIES', 2400, '2026-01-03')],
      [{ date: '2026-01-03', calories: 2000 }]
    )[2].balance
  ).toBeNull();
});

it('preserves observed extrema and coverage without carrying body values or fabricating bins', () => {
  const result = aggregateHealthHistory(
    '2020-01-01',
    '2026-01-01',
    '2026-01-02',
    [
      record('WEIGHT', 60, '2020-01-02'),
      record('WEIGHT', 100, '2020-01-05'),
      record('WEIGHT', NaN, '2020-02-01'),
      record('SLEEP', 0, '2020-01-02'),
    ],
    []
  );
  expect(result.aggregation).toBe('monthly');
  expect(result.points[0]).toMatchObject({
    weight: 80,
    sleep: 0,
    statistics: { weight: { count: 2, min: 60, max: 100 } },
  });
  expect(result.points[1].weight).toBeNull();
  expect(result.points.length).toBeLessThan(100);
});
