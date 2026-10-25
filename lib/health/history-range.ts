import { z } from 'zod';
import { diaryDate, diaryDateSchema, shiftDiaryDate } from '@/lib/nutrition/dates';

export const healthRanges = [
  { value: '10d', label: 'Last 10 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '3m', label: 'Last 3 months' },
  { value: '6m', label: 'Last 6 months' },
  { value: '1y', label: 'Last year' },
  { value: 'all', label: 'All time' },
] as const;
export const healthRangeSchema = z.enum(['10d', '30d', '3m', '6m', '1y', 'all']);
export type HealthRange = z.infer<typeof healthRangeSchema>;
export const healthChartInputSchema = z.object({
  endDate: diaryDateSchema,
  range: healthRangeSchema,
});

export const calendarDays = (start: string, end: string) =>
  Math.round((diaryDate(end).getTime() - diaryDate(start).getTime()) / 86_400_000) + 1;

/** Dates are local calendar labels, never elapsed 24-hour windows. Clamp month ends. */
export function healthRangeStart(end: string, range: HealthRange) {
  if (range === 'all') {
    return null;
  }
  if (range === '10d' || range === '30d') {
    const days = range === '10d' ? 10 : 30;
    return calendarDays('0001-01-01', end) < days ? '0001-01-01' : shiftDiaryDate(end, 1 - days);
  }
  const months = { '3m': 3, '6m': 6, '1y': 12 }[range];
  const date = diaryDate(end);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  if (date.getUTCFullYear() < 1) {
    return '0001-01-01';
  }
  const last = new Date(date.getTime());
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  date.setUTCDate(Math.min(day, last.getUTCDate()));
  return date.toISOString().slice(0, 10);
}

export function historyBuckets(start: string, end: string) {
  const days = calendarDays(start, end);
  const months =
    (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
    Number(end.slice(5, 7)) -
    Number(start.slice(5, 7)) +
    1;
  const monthStep = Math.max(1, Math.ceil(months / 180));
  const aggregation = days <= 93 ? 'daily' : days <= 366 ? 'weekly' : 'monthly';
  const buckets: { start: string; end: string; expectedDays: number }[] = [];
  let cursor = start;
  while (cursor <= end) {
    const date = diaryDate(cursor);
    let next: string;
    if (aggregation === 'daily') {
      // Avoid overflowing the supported final calendar date.
      if (cursor === end) {
        buckets.push({ start: cursor, end, expectedDays: 1 });
        break;
      }
      next = shiftDiaryDate(cursor, 1);
    } else if (aggregation === 'weekly') {
      date.setUTCDate(date.getUTCDate() + (8 - (date.getUTCDay() || 7)));
      next = date.toISOString().slice(0, 10);
    } else {
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + monthStep);
      next = date.getUTCFullYear() > 9999 ? '9999-12-31' : date.toISOString().slice(0, 10);
    }
    const bucketEnd = next > end || next === '9999-12-31' ? end : shiftDiaryDate(next, -1);
    buckets.push({ start: cursor, end: bucketEnd, expectedDays: calendarDays(cursor, bucketEnd) });
    if (bucketEnd === end) {
      break;
    }
    cursor = next;
  }
  return { aggregation, monthStep, buckets };
}
