import { compatibleCalories } from './calorie-projection';
import { historyBuckets } from './history-range';
import { calorieBalance } from './normalization';
import { validMetricValue, type MetricKind } from './schema';
import { dateInTimezone, shiftDiaryDate } from '@/lib/nutrition/dates';

export type HistoryRecord = {
  date: string;
  metric: MetricKind;
  value: number;
  source: string;
  metadata?: unknown;
};
const fields = {
  weight: 'WEIGHT',
  lean: 'LEAN_MASS',
  fat: 'BODY_FAT',
  sleep: 'SLEEP',
  steps: 'STEPS',
  bmr: 'BMR',
} as const;
export type HistoryField = keyof typeof fields;

export function splitCalories(total: number | null, active: number | null, compatible: boolean) {
  if (
    !compatible ||
    total === null ||
    active === null ||
    !Number.isFinite(total) ||
    !Number.isFinite(active) ||
    active < 0 ||
    total < active
  ) {
    return null;
  }
  return { active, resting: total - active };
}

function completeBurn(record: HistoryRecord) {
  if (record.source !== 'samsung_health') {
    return true;
  }
  const metadata = record.metadata as Record<string, unknown> | null;
  if (typeof metadata?.periodEnd !== 'string' || typeof metadata.timezone !== 'string') {
    return false;
  }
  try {
    const end = new Date(metadata.periodEnd);
    return (
      dateInTimezone(metadata.timezone, end) === shiftDiaryDate(record.date, 1) &&
      new Intl.DateTimeFormat('en-GB', {
        timeZone: metadata.timezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).format(end) === '00:00:00' &&
      end.getUTCMilliseconds() === 0
    );
  } catch {
    return false;
  }
}

/** Input has already been deduplicated using the shared source/date precedence query. */
export function aggregateHealthHistory(
  start: string,
  end: string,
  today: string,
  records: HistoryRecord[],
  nutrition: { date: string; calories: number }[]
) {
  const { aggregation, monthStep, buckets } = historyBuckets(start, end);
  const byDate = new Map<string, Map<MetricKind, HistoryRecord>>();
  for (const record of records) {
    if (
      record.date < start ||
      record.date > end ||
      !validMetricValue(record.metric, record.value)
    ) {
      continue;
    }
    const day = byDate.get(record.date) ?? new Map<MetricKind, HistoryRecord>();
    day.set(record.metric, record);
    byDate.set(record.date, day);
  }
  const intake = new Map(
    nutrition
      .filter((x) => Number.isFinite(x.calories) && x.calories >= 0)
      .map((x) => [x.date, x.calories])
  );
  // Walk sparse observed dates once; don't generate a row for every day in all-time histories.
  const dates = [...new Set([...byDate.keys(), ...intake.keys()])].sort();
  let cursor = 0;
  const points = buckets.map((bucket) => {
    const values = Object.fromEntries(
      Object.keys(fields).map((key) => [key, [] as number[]])
    ) as Record<HistoryField, number[]>;
    let total = 0,
      active = 0,
      resting = 0,
      burnedDays = 0,
      completeBurnDays = 0,
      splitDays = 0,
      balanceDays = 0,
      balance = 0;
    while (cursor < dates.length && dates[cursor] < bucket.start) {
      cursor++;
    }
    while (cursor < dates.length && dates[cursor] <= bucket.end) {
      const date = dates[cursor++];
      const day = byDate.get(date);
      for (const [key, metric] of Object.entries(fields)) {
        const value = day?.get(metric)?.value;
        if (value !== undefined) {
          values[key as HistoryField].push(value);
        }
      }
      const burn = day?.get('TOTAL_CALORIES');
      if (burn) {
        total += burn.value;
        burnedDays++;
        const closedBurn = date < today && completeBurn(burn);
        if (closedBurn) {
          completeBurnDays++;
        }
        const a = day?.get('ACTIVE_CALORIES');
        const split = splitCalories(burn.value, a?.value ?? null, compatibleCalories(burn, a));
        if (split) {
          active += split.active;
          resting += split.resting;
          splitDays++;
        }
        const daily = calorieBalance(intake.get(date) ?? null, burn.value, null).balance;
        // An open local day is never a completed historical balance.
        if (daily !== null && closedBurn) {
          balance += daily;
          balanceDays++;
        }
      }
    }
    const statistics = Object.fromEntries(
      Object.entries(values).map(([key, list]) => [
        key,
        {
          count: list.length,
          min: list.length ? Math.min(...list) : null,
          max: list.length ? Math.max(...list) : null,
        },
      ])
    ) as Record<HistoryField, { count: number; min: number | null; max: number | null }>;
    const means = Object.fromEntries(
      Object.entries(values).map(([key, list]) => [
        key,
        list.length ? list.reduce((sum, x) => sum + x, 0) / list.length : null,
      ])
    ) as Record<HistoryField, number | null>;
    const decomposed = burnedDays > 0 && splitDays === burnedDays;
    return {
      date: bucket.start === bucket.end ? bucket.start : `${bucket.start} – ${bucket.end}`,
      ...bucket,
      ...means,
      statistics,
      burnedDays,
      completeBurnDays,
      balanceDays,
      total: burnedDays ? total : null,
      active: decomposed ? active : null,
      resting: decomposed ? resting : null,
      unsplit: burnedDays && !decomposed ? total : null,
      balance: balanceDays === bucket.expectedDays ? Math.round(balance * 100) / 100 : null,
      provisional: bucket.end >= today,
    };
  });
  return { aggregation, monthStep, points };
}
