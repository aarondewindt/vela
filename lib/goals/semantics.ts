import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/index-browser';

const GoalDecimal = Decimal.clone({ precision: 60 });
const decimal = z
  .string()
  .max(32)
  .regex(/^-?\d{1,12}(\.\d{1,8})?$/, 'Enter a decimal number.');
export const goalOptionsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('minimum') }).strict(),
  z.object({ kind: z.literal('maximum') }).strict(),
  z
    .object({
      kind: z.literal('target'),
      tolerance: decimal
        .refine((v) => new GoalDecimal(v).gte(0), 'Tolerance cannot be negative.')
        .optional(),
    })
    .strict(),
  z.object({ kind: z.literal('range'), upperBound: decimal }).strict(),
]);
export type GoalOptions = z.infer<typeof goalOptionsSchema>;
export const defaultGoalOptions: GoalOptions = { kind: 'target' };
export const goalStatusLabels = {
  unset: 'No goal set',
  unknown: 'Waiting for data',
  below: 'Below goal',
  within: 'Within goal',
  above: 'Above goal',
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
  const status: keyof typeof goalStatusLabels =
    amount === null
      ? 'unset'
      : current === null
        ? 'unknown'
        : lower !== null && current.lt(lower)
          ? 'below'
          : upper !== null && current.gt(upper)
            ? 'above'
            : 'within';
  return {
    status,
    satisfied: status === 'unset' || status === 'unknown' ? null : status === 'within',
    lowerBound: lower?.toFixed() ?? null,
    upperBound: upper?.toFixed() ?? null,
    difference: current === null || amount === null ? null : current.minus(amount).toFixed(),
  };
}

export function validateGoalBounds(target: string | null, options: GoalOptions) {
  return (
    target === null || options.kind !== 'range' || new GoalDecimal(options.upperBound).gte(target)
  );
}

export function describeGoal(target: string | null, options: GoalOptions = defaultGoalOptions) {
  if (target === null) {
    return 'No goal set';
  }
  switch (options.kind) {
    case 'minimum':
      return `At least ${target}`;
    case 'maximum':
      return `At most ${target}`;
    case 'range':
      return `${target} to ${options.upperBound}`;
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
