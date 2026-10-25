export interface GaugeScaleInput {
  goalMin: number | null;
  goalMax: number | null;
  goalPreferred: number | null;
  balance: number | null;
  projectedBalance?: number | null;
}

/** Issue #24: preserve the default span by translating before expanding it. */
export function calorieBalanceGaugeScale({
  goalMin,
  goalMax,
  goalPreferred,
  balance,
  projectedBalance,
}: GaugeScaleInput) {
  if (
    goalMin === null ||
    goalMax === null ||
    goalPreferred === null ||
    balance === null ||
    ![goalMin, goalMax, goalPreferred, balance].every(Number.isFinite) ||
    goalMin >= goalMax ||
    goalPreferred < goalMin ||
    goalPreferred > goalMax
  ) {
    return null;
  }

  const defaultSpan = (goalMax - goalMin) / 0.2;
  const defaultMin = goalPreferred - defaultSpan / 2;
  const requiredMin = Math.min(
    goalMin,
    balance,
    Number.isFinite(projectedBalance) ? projectedBalance! : balance
  );
  const requiredMax = Math.max(
    goalMax,
    balance,
    Number.isFinite(projectedBalance) ? projectedBalance! : balance
  );
  const span = Math.max(defaultSpan, (requiredMax - requiredMin) / 0.9);
  const lowestMin = requiredMax - 0.95 * span;
  const highestMin = requiredMin - 0.05 * span;
  const min = Math.max(lowestMin, Math.min(defaultMin, highestMin));
  const max = min + span;
  if (![span, min, max].every(Number.isFinite) || span <= 0 || max <= min) {
    return null;
  }

  // Clamp only floating-point edge noise; do not round positions or domain bounds.
  const position = (value: number) => Math.max(5, Math.min(95, ((value - min) / span) * 100));
  return {
    min,
    max,
    span,
    goalStart: position(goalMin),
    goalEnd: position(goalMax),
    target: position(balance),
    projectedTarget: Number.isFinite(projectedBalance) ? position(projectedBalance!) : null,
  };
}
