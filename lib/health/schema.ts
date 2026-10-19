import { z } from 'zod';
import { diaryDateSchema } from '@/lib/nutrition/dates';
export const metricKinds = ['WEIGHT', 'BODY_FAT', 'LEAN_MASS', 'SLEEP', 'TOTAL_CALORIES'] as const;
export type MetricKind = (typeof metricKinds)[number];
export const metricLabels: Record<MetricKind, string> = {
  WEIGHT: 'Weight',
  BODY_FAT: 'Body fat',
  LEAN_MASS: 'Lean mass',
  SLEEP: 'Sleep',
  TOTAL_CALORIES: 'Total calories burned',
};
export const metricUnits: Record<MetricKind, string> = {
  WEIGHT: 'kg',
  BODY_FAT: '%',
  LEAN_MASS: 'kg',
  SLEEP: 'hours',
  TOTAL_CALORIES: 'kcal',
};
export const goalSchema = z.object({
  version: z.number().int().nonnegative(),
  calorieBalance: z.number().int().min(-10000).max(10000).nullable(),
});
export const mappingSchema = z
  .array(
    z.object({
      metric: z.enum(metricKinds),
      entityId: z
        .string()
        .regex(/^sensor\.[a-z0-9_]+$/)
        .max(240),
    })
  )
  .max(5)
  .superRefine((items, ctx) => {
    if (
      new Set(items.map((x) => x.metric)).size !== items.length ||
      new Set(items.map((x) => x.entityId)).size !== items.length
    ) {
      ctx.addIssue({ code: 'custom', message: 'Map each metric and sensor only once.' });
    }
  });
export const manualMetricSchema = z
  .object({
    requestId: z.uuid(),
    metric: z.enum(metricKinds),
    date: diaryDateSchema,
    value: z.number().finite().nonnegative().max(100000),
  })
  .superRefine((input, ctx) => {
    if (!validMetricValue(input.metric, input.value)) {
      ctx.addIssue({ code: 'custom', message: 'Value is outside the range for this metric.' });
    }
  });
export function validMetricValue(metric: MetricKind, value: number) {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <=
      { WEIGHT: 1000, BODY_FAT: 100, LEAN_MASS: 1000, SLEEP: 24, TOTAL_CALORIES: 100000 }[metric] &&
    (!['WEIGHT', 'LEAN_MASS'].includes(metric) || value > 0)
  );
}
