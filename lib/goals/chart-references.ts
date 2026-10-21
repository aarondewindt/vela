import type { LineChartProps } from '@mantine/charts';
import { defaultGoalOptions, evaluateGoal, type GoalOptions } from './semantics';

/** Current user goals, independent of missing observations or the selected date window. */
export function goalChartReferences(
  target: string | null,
  options: GoalOptions = defaultGoalOptions,
  label = 'Goal',
  color = 'teal.6'
): Pick<LineChartProps, 'referenceLines' | 'referenceAreas'> {
  if (target === null) {
    return { referenceLines: [], referenceAreas: [] };
  }
  const { lowerBound, upperBound } = evaluateGoal(null, target, options);
  const lines = new Map<number, string>();
  if (options.kind === 'target') {
    lines.set(Number(target), `${label} target`);
  } else {
    if (lowerBound !== null) {
      lines.set(Number(lowerBound), `${label} minimum`);
    }
    if (upperBound !== null) {
      lines.set(Number(upperBound), `${label} maximum`);
    }
  }
  if (
    (options.kind === 'range' || options.kind === 'minimum') &&
    options.preferredTarget !== undefined
  ) {
    lines.set(Number(options.preferredTarget), `${label} preferred`);
  }
  if (options.kind === 'minimum' && options.excellent !== undefined) {
    lines.set(Number(options.excellent), `${label} excellent`);
  }
  return {
    referenceLines: [...lines].map(([y, name]) => ({
      y,
      label: name,
      color,
      ifOverflow: 'extendDomain',
    })),
    referenceAreas:
      lowerBound !== null && upperBound !== null && lowerBound !== upperBound
        ? [
            {
              y1: Number(lowerBound),
              y2: Number(upperBound),
              color,
              fillOpacity: 0.1,
              ifOverflow: 'extendDomain',
            },
          ]
        : [],
  };
}
