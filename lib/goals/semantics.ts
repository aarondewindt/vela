import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/index-browser';

const GoalDecimal = Decimal.clone({ precision: 60 });
const decimal = z
  .string()
  .max(32)
  .regex(/^-?\d{1,12}(\.\d{1,8})?$/, 'Enter a decimal number.');
export const goalOptionsSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('minimum'),
      preferredTarget: decimal.optional(),
      excellent: decimal.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('maximum') }).strict(),
  z
    .object({
      kind: z.literal('target'),
      tolerance: decimal
        .refine((v) => new GoalDecimal(v).gte(0), 'Tolerance cannot be negative.')
        .optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal('range'), upperBound: decimal, preferredTarget: decimal.optional() })
    .strict(),
]);
export type GoalOptions = z.infer<typeof goalOptionsSchema>;
export const defaultGoalOptions: GoalOptions = { kind: 'target' };
export const goalStatusLabels = {
  unset: 'No goal set',
  unknown: 'Waiting for data',
  below: 'Below goal',
  within: 'Within goal',
  above: 'Above goal',
  minimum: 'Minimum reached — keep going!',
  reached: 'Goal reached!',
  excellent: 'Excellent goal reached!',
} as const;

// Consumers resolve configured or future calculated targets before calling this pure evaluator.
// Null observations are unknown, never zero. All bounds are inclusive.
export function evaluateGoal(
  value: string | null,
  target: string | null,
  options: GoalOptions = defaultGoalOptions
) {
  const amount = target === null ? null : new GoalDecimal(target);
  const tolerance =
    options.kind === 'target' ? new GoalDecimal(options.tolerance ?? 0) : new GoalDecimal(0);
  const lower = amount === null || options.kind === 'maximum' ? null : amount.minus(tolerance);
  const upper =
    amount === null || options.kind === 'minimum'
      ? null
      : options.kind === 'range'
        ? new GoalDecimal(options.upperBound)
        : amount.plus(tolerance);
  const current = value === null ? null : new GoalDecimal(value);
  let status: keyof typeof goalStatusLabels =
    amount === null
      ? 'unset'
      : current === null
        ? 'unknown'
        : lower !== null && current.lt(lower)
          ? 'below'
          : upper !== null && current.gt(upper)
            ? 'above'
            : 'within';
  if (status === 'within' && options.kind === 'minimum') {
    status =
      options.excellent !== undefined && current!.gte(options.excellent)
        ? 'excellent'
        : options.preferredTarget === undefined || current!.gte(options.preferredTarget)
          ? 'reached'
          : 'minimum';
  }
  const preferred =
    options.kind === 'minimum' || options.kind === 'range' ? options.preferredTarget : undefined;
  return {
    status,
    color:
      status === 'below'
        ? options.kind === 'minimum'
          ? 'red'
          : 'orange'
        : status === 'above'
          ? 'red'
          : status === 'minimum'
            ? 'orange'
            : status === 'excellent'
              ? 'cyan'
              : status === 'reached'
                ? 'green'
                : status === 'within'
                  ? 'teal'
                  : 'dimmed',
    satisfied:
      status === 'unset' || status === 'unknown'
        ? null
        : ['within', 'minimum', 'reached', 'excellent'].includes(status),
    lowerBound: lower?.toFixed() ?? null,
    upperBound: upper?.toFixed() ?? null,
    difference:
      current === null || amount === null ? null : current.minus(preferred ?? amount).toFixed(),
  };
}

export function validateGoalBounds(target: string | null, options: GoalOptions) {
  if (target === null) {
    return true;
  }
  const base = new GoalDecimal(target);
  if (options.kind === 'range' || options.kind === 'minimum') {
    const preferred =
      options.preferredTarget === undefined ? base : new GoalDecimal(options.preferredTarget);
    if (preferred.lt(base)) {
      return false;
    }
    if (options.kind === 'range') {
      return new GoalDecimal(options.upperBound).gte(preferred);
    }
    if (options.excellent !== undefined) {
      return (
        options.preferredTarget !== undefined && new GoalDecimal(options.excellent).gte(preferred)
      );
    }
  }
  return true;
}

export function describeGoal(target: string | null, options: GoalOptions = defaultGoalOptions) {
  if (target === null) {
    return 'No goal set';
  }
  switch (options.kind) {
    case 'minimum':
      return `Minimum ${target}${options.preferredTarget ? ` · target ${options.preferredTarget}` : ''}${options.excellent ? ` · excellent ${options.excellent}` : ''}`;
    case 'maximum':
      return `At most ${target}`;
    case 'range':
      return `${target} to ${options.upperBound}${options.preferredTarget ? ` · preferred ${options.preferredTarget}` : ''}`;
    case 'target':
      return options.tolerance && new GoalDecimal(options.tolerance).gt(0)
        ? `${target} ± ${options.tolerance}`
        : `Target ${target}`;
  }
}

export function readGoalOptions(raw: unknown): GoalOptions {
  if (raw == null || (typeof raw === 'object' && Object.keys(raw).length === 0)) {
    return defaultGoalOptions;
  }
  return goalOptionsSchema.parse(raw);
}
