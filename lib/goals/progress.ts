import { evaluateGoal, type GoalOptions } from './semantics';

// Presentation scale for nonnegative amounts. Evaluation remains decimal-based.
// Leave 10% beyond the desired upper edge initially, and 5% beyond an overage.
export function goalProgressScale(value: string, target: string | null, options: GoalOptions) {
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
  const desiredEdge = upper ?? goal;
  const maximum = Math.max(desiredEdge / 0.9, current / 0.95);
  const position = (amount: number) => Math.max(0, Math.min(100, (amount / maximum) * 100));
  return {
    maximum,
    fill: position(current),
    target: position(goal),
    lower: lower === null ? null : position(lower),
    upper: upper === null ? null : position(upper),
    // A maximum is satisfied even at zero; exceeding a minimum stays successful.
    color: evaluation.satisfied ? 'teal' : evaluation.status === 'above' ? 'red' : 'orange',
    status: evaluation.status,
  };
}
