import { dateInTimezone, diaryDate, shiftDiaryDate } from '@/lib/nutrition/dates';

export type CalorieRecord = {
  date: string;
  value: number;
  source: string;
  observedAt?: Date;
  metadata?: unknown;
};
export function calorieMetadata(record?: { metadata?: unknown } | null) {
  return (record?.metadata ?? {}) as Record<string, unknown>;
}

/** #110: only the known Companion ActivitySummary adapter is classified here.
 * Samsung documents TOTAL_CALORIES_BURNED and TOTAL_ACTIVE_CALORIES_BURNED as
 * aggregates over LocalTimeFilter, with midnight-to-now examples. These are
 * interval expenditure. The obsolete Health Connect sync path is not used (#57).
 * The legacy wire kind predates this verification; it identifies the same adapter.
 * Export/HA/manual values and explicit full-day-inclusive semantics stay excluded.
 * https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.request/-data-type/-activity-summary-type/-companion/-t-o-t-a-l_-c-a-l-o-r-i-e-s_-b-u-r-n-e-d.html
 */
export function elapsedCalories(record?: CalorieRecord | null) {
  const m = calorieMetadata(record);
  return (
    !!record &&
    record.source === 'samsung_health' &&
    (m.measurementKind === 'sdk_aggregate_semantics_unverified' ||
      m.measurementKind === 'sdk_activity_summary_elapsed') &&
    (m.calorieSemantics === undefined || m.calorieSemantics === 'elapsed_expenditure')
  );
}

export function compatibleCalories(total: CalorieRecord, active?: CalorieRecord | null) {
  if (
    !active ||
    !elapsedCalories(total) ||
    !elapsedCalories(active) ||
    total.date !== active.date
  ) {
    return false;
  }
  const t = calorieMetadata(total),
    a = calorieMetadata(active);
  return (
    ['timezone', 'credentialId'].every((key) => typeof t[key] === 'string' && t[key] === a[key]) &&
    ['periodStart', 'periodEnd'].every((key) => {
      const time = new Date(String(t[key])).getTime();
      return Number.isFinite(time) && time === new Date(String(a[key])).getTime();
    })
  );
}

/** Find actual calendar boundaries, including 23/25-hour days and midnight gaps. */
export function localDayBounds(date: string, timezone: string) {
  const boundary = (day: string) => {
    const utc = diaryDate(day).getTime();
    let lo = utc - 36 * 3600000,
      hi = utc + 36 * 3600000;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (dateInTimezone(timezone, new Date(mid)) < day) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return hi;
  };
  return { start: boundary(date), end: boundary(shiftDiaryDate(date, 1)) };
}

export function projectCalorieBurn({
  total,
  bmr,
  date,
  timezone,
  now = new Date(),
}: {
  total?: CalorieRecord | null;
  bmr?: CalorieRecord | null;
  date: string;
  timezone: string;
  now?: Date;
}) {
  const unavailable = (reason: string) => ({ projection: null, reason });
  if (!total || !elapsedCalories(total)) {
    return unavailable('Compatible Samsung interval total unavailable');
  }
  const m = calorieMetadata(total),
    bm = calorieMetadata(bmr);
  if (
    !bmr ||
    bmr.source !== 'samsung_health' ||
    bm.measurementKind !== 'sdk_bmr_point' ||
    !Number.isFinite(bmr.value) ||
    bmr.value < 100 ||
    bmr.value > 12000
  ) {
    return unavailable('Samsung BMR unavailable');
  }
  try {
    if (dateInTimezone(timezone, now) !== date) {
      return unavailable('Only the current local day can be projected');
    }
    const { start, end } = localDayBounds(date, timezone);
    const cutoff = new Date(String(m.periodEnd)).getTime();
    const bmrAt = new Date(String(bm.sourceObservedAt)).getTime();
    if (
      dateInTimezone(timezone, now) !== date ||
      total.date !== date ||
      m.timezone !== timezone ||
      new Date(String(m.periodStart)).getTime() !== start ||
      !Number.isFinite(cutoff) ||
      cutoff <= start ||
      cutoff > end ||
      cutoff > now.getTime() ||
      !total.observedAt ||
      cutoff > total.observedAt.getTime() ||
      total.observedAt > now ||
      !Number.isFinite(bmrAt) ||
      bmrAt > cutoff ||
      !Number.isFinite(total.value) ||
      total.value < 0
    ) {
      return unavailable('Total or BMR has an incompatible day, timestamp or value');
    }
    // Use the source query cutoff, never receipt/now. Unobserved time gets BMR only.
    const remainingDayFraction = (end - cutoff) / (end - start);
    return {
      reason: null,
      projection: {
        derivation: 'observed_total_plus_remaining_bmr' as const,
        version: 'bmr-baseline-v1' as const,
        observedTotal: total.value,
        projectedTotal: total.value + bmr.value * remainingDayFraction,
        cutoff: new Date(cutoff).toISOString(),
        capturedAt: total.observedAt.toISOString(),
        dayEnd: new Date(end).toISOString(),
        timezone,
        remainingDayFraction,
        bmr: bmr.value,
        bmrObservedAt: new Date(bmrAt).toISOString(),
        ageMinutes: (now.getTime() - cutoff) / 60000,
        assumptions: 'No further food intake or active expenditure; remaining burn uses BMR only',
      },
    };
  } catch {
    return unavailable('Invalid local day or timezone');
  }
}
export type BurnProjection = NonNullable<ReturnType<typeof projectCalorieBurn>['projection']>;
