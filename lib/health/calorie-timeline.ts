import {
  calorieMetadata,
  compatibleCalories,
  elapsedCalories,
  localDayBounds,
  projectCalorieBurn,
  type CalorieRecord,
} from './calorie-projection';
import { splitCalories } from './history-aggregation';

type Record = CalorieRecord & { metric: string };
/** No interpolation or synthetic observed bins. Latest revision wins for each cutoff. */
export function calorieTimeline(
  date: string,
  timezone: string,
  captures: Record[],
  daily: Record[],
  now = new Date()
) {
  const total = daily.find((r) => r.metric === 'TOTAL_CALORIES' && r.date === date);
  const bmr = daily
    .filter((r) => r.metric === 'BMR' && r.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const result = projectCalorieBurn({ total, bmr, date, timezone, now });
  const bounds = localDayBounds(date, timezone);
  const origin = calorieMetadata(total).credentialId;
  const selected = new Map<string, Record>();
  // Daily/capture reads may straddle an upload. Include the authoritative real
  // rows so the selected projection always has its observed anchor.
  const observations = [
    ...captures,
    ...daily.filter(
      (r) => r.date === date && ['TOTAL_CALORIES', 'ACTIVE_CALORIES'].includes(r.metric)
    ),
  ];
  for (const r of observations.sort(
    (a, b) => (a.observedAt?.getTime() ?? 0) - (b.observedAt?.getTime() ?? 0)
  )) {
    const m = calorieMetadata(r);
    if (
      r.date !== date ||
      !elapsedCalories(r) ||
      m.timezone !== timezone ||
      m.credentialId !== origin ||
      new Date(String(m.periodStart)).getTime() !== bounds.start
    ) {
      continue;
    }
    const cutoff = new Date(String(m.periodEnd)).getTime();
    if (
      !Number.isFinite(cutoff) ||
      cutoff <= bounds.start ||
      cutoff > Math.min(bounds.end, now.getTime()) ||
      !r.observedAt ||
      !Number.isFinite(r.observedAt.getTime()) ||
      cutoff > r.observedAt.getTime() ||
      r.observedAt > now
    ) {
      continue;
    }
    selected.set(`${r.metric}:${cutoff}`, r);
  }
  const points = [...selected.values()]
    .filter((r) => r.metric === 'TOTAL_CALORIES')
    .map((r) => {
      const time = new Date(String(calorieMetadata(r).periodEnd)).getTime();
      const active = selected.get(`ACTIVE_CALORIES:${time}`);
      const split = splitCalories(r.value, active?.value ?? null, compatibleCalories(r, active));
      return {
        time,
        total: Number.isFinite(r.value) && r.value >= 0 ? r.value : null,
        active: split?.active ?? null,
        resting: split?.resting ?? null,
        projected: result.projection?.cutoff === new Date(time).toISOString() ? r.value : null,
        capturedAt: r.observedAt!.toISOString(),
        issue: split
          ? null
          : 'Active/resting unavailable: missing, incompatible or invalid active reading',
      };
    })
    .sort((a, b) => a.time - b.time);
  if (result.projection) {
    points.push({
      time: bounds.end,
      total: null,
      active: null,
      resting: null,
      projected: result.projection.projectedTotal,
      capturedAt: result.projection.capturedAt,
      issue: null,
    });
  }
  return { date, timezone, start: bounds.start, end: bounds.end, points, ...result };
}
export type CalorieTimeline = ReturnType<typeof calorieTimeline>;
