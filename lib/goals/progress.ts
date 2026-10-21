import { evaluateGoal, type GoalOptions } from './semantics';

// Presentation scale for nonnegative amounts. Evaluation remains decimal-based.
// Leave 10% beyond the desired upper edge initially, and 5% beyond an overage.
export function goalProgressScale(
  value: string | null,
  target: string | null,
  options: GoalOptions
) {
  if (value === null) {
    return null;
  }
  const current = Number(value);
  const goal = target === null ? null : Number(target);
  if (
    goal === null ||
    goal <= 0 ||
    current < 0 ||
    !Number.isFinite(current) ||
    !Number.isFinite(goal)
  ) {
    return null;
  }
  const evaluation = evaluateGoal(value, target, options);
  const lower = evaluation.lowerBound === null ? null : Number(evaluation.lowerBound);
  const upper = evaluation.upperBound === null ? null : Number(evaluation.upperBound);
  const preferred =
    options.kind === 'minimum' || options.kind === 'range'
      ? Number(options.preferredTarget ?? goal)
      : goal;
  const excellent =
    options.kind === 'minimum' && options.excellent !== undefined
      ? Number(options.excellent)
      : null;
  const desiredEdge = excellent ?? upper ?? preferred;
  const maximum = Math.max(desiredEdge / 0.9, current / 0.95);
  const position = (amount: number) => Math.max(0, Math.min(100, (amount / maximum) * 100));
  return {
    maximum,
    fill: position(current),
    target: position(preferred),
    excellent: excellent === null ? null : position(excellent),
    lower: lower === null ? null : position(lower),
    upper: upper === null ? null : position(upper),
    // A maximum is satisfied even at zero; exceeding a minimum stays successful.
    color: evaluation.color,
    status: evaluation.status,
  };
}
