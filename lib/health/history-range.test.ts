import { dateInTimezone } from '@/lib/nutrition/dates';
import { calendarDays, healthRangeStart, historyBuckets } from './history-range';

it('uses inclusive local calendar days over both DST transitions', () => {
  for (const instant of ['2026-03-29T01:30:00Z', '2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z']) {
    const end = dateInTimezone('Europe/Amsterdam', new Date(instant));
    const start = healthRangeStart(end, '10d')!;
    expect(calendarDays(start, end)).toBe(10);
    expect(historyBuckets(start, end).buckets).toHaveLength(10);
  }
  expect(dateInTimezone('America/Los_Angeles', new Date('2026-10-25T00:30:00Z'))).toBe(
    '2026-10-24'
  );
});

it('uses calendar months, clamps month ends and handles leap years and earliest dates', () => {
  expect(healthRangeStart('2026-05-31', '3m')).toBe('2026-02-28');
  expect(healthRangeStart('2024-05-31', '3m')).toBe('2024-02-29');
  expect(healthRangeStart('2024-02-29', '1y')).toBe('2023-02-28');
  expect(healthRangeStart('2026-10-25', '6m')).toBe('2026-04-25');
  expect(healthRangeStart('2026-10-25', '30d')).toBe('2026-09-26');
  expect(healthRangeStart('2026-10-25', 'all')).toBeNull();
  for (const range of ['10d', '30d', '3m', '6m', '1y'] as const) {
    expect(healthRangeStart('0001-01-01', range)).toBe('0001-01-01');
  }
});

it('bounds long histories and covers every selected day exactly once', () => {
  for (const [start, end] of [
    ['2026-01-30', '2026-07-30'],
    ['2000-02-29', '2026-10-25'],
    ['0001-01-01', '9999-12-31'],
  ]) {
    const { buckets } = historyBuckets(start, end);
    expect(buckets.length).toBeLessThanOrEqual(181);
    expect(buckets[0].start).toBe(start);
    expect(buckets.at(-1)!.end).toBe(end);
    expect(buckets.reduce((sum, bucket) => sum + bucket.expectedDays, 0)).toBe(
      calendarDays(start, end)
    );
  }
});
