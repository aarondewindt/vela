import { goalOptionsSchema, validateGoalBounds } from '@/lib/goals/semantics';
import { z } from 'zod';
import { diaryDateSchema } from '@/lib/nutrition/dates';
export const metricKinds = [
  'WEIGHT',
  'BODY_FAT',
  'LEAN_MASS',
  'SLEEP',
  'TOTAL_CALORIES',
  'ACTIVE_CALORIES',
] as const;
export type MetricKind = (typeof metricKinds)[number];
export const metricLabels: Record<MetricKind, string> = {
  WEIGHT: 'Weight',
  BODY_FAT: 'Body fat',
  LEAN_MASS: 'Lean mass',
  SLEEP: 'Sleep',
  TOTAL_CALORIES: 'Total calories burned',
  ACTIVE_CALORIES: 'Active calories burned',
};
export const metricUnits: Record<MetricKind, string> = {
  WEIGHT: 'kg',
  BODY_FAT: '%',
  LEAN_MASS: 'kg',
  SLEEP: 'hours',
  TOTAL_CALORIES: 'kcal',
  ACTIVE_CALORIES: 'kcal',
};
export const goalMetricKinds = ['WEIGHT', 'BODY_FAT', 'SLEEP'] as const;
const metricGoalSchema = z
  .object({
    target: z.number().finite().nullable(),
    semantics: goalOptionsSchema,
  })
  .strict();
export const metricGoalsSchema = z
  .object({
    WEIGHT: metricGoalSchema.optional(),
    BODY_FAT: metricGoalSchema.optional(),
    SLEEP: metricGoalSchema.optional(),
  })
  .strict()
  .superRefine((goals, ctx) => {
    for (const metric of goalMetricKinds) {
      const goal = goals[metric];
      if (!goal || goal.target === null) {
        continue;
      }
      const options = goal.semantics;
      const values = [goal.target];
      if (options.kind === 'range' || options.kind === 'minimum') {
        if (options.preferredTarget !== undefined) {
          values.push(Number(options.preferredTarget));
        }
        if (options.kind === 'range') {
          values.push(Number(options.upperBound));
        } else if (options.excellent !== undefined) {
          values.push(Number(options.excellent));
        }
      }
      if (options.kind === 'target') {
        values.push(
          goal.target - Number(options.tolerance ?? 0),
          goal.target + Number(options.tolerance ?? 0)
        );
      }
      if (
        !validateGoalBounds(String(goal.target), options) ||
        values.some((value) => !validMetricValue(metric, value))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: [metric],
          message: `Enter ordered ${metricLabels[metric].toLowerCase()} goals within the metric's valid range.`,
        });
      }
    }
  });
export type MetricGoals = z.infer<typeof metricGoalsSchema>;
export const goalSchema = z
  .object({
    semantics: goalOptionsSchema.optional(),
    metricGoals: metricGoalsSchema.optional(),
    version: z.number().int().nonnegative(),
    calorieBalance: z.number().int().min(-10000).max(10000).nullable(),
  })
  .superRefine((input, ctx) => {
    const options = input.semantics;
    if (!options) {
      return;
    }
    if (
      !validateGoalBounds(input.calorieBalance?.toString() ?? null, options) ||
      ((options.kind === 'range' || options.kind === 'minimum') &&
        [
          options.preferredTarget,
          options.kind === 'range' ? options.upperBound : options.excellent,
        ].some((value) => value !== undefined && Math.abs(Number(value)) > 10000)) ||
      (options.kind === 'target' && Number(options.tolerance ?? 0) > 20000)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['semantics'],
        message: 'Use an ordered range within −10000 to 10000 kcal and tolerance up to 20000 kcal.',
      });
    }
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
  .max(6)
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
      {
        WEIGHT: 1000,
        BODY_FAT: 100,
        LEAN_MASS: 1000,
        SLEEP: 24,
        TOTAL_CALORIES: 100000,
        ACTIVE_CALORIES: 100000,
      }[metric] &&
    (!['WEIGHT', 'LEAN_MASS'].includes(metric) || value > 0)
  );
}
