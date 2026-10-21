import type { LineChartProps } from '@mantine/charts';
import { defaultGoalOptions, evaluateGoal, type GoalOptions } from './semantics';

/** Current user goals, independent of missing observations or the selected date window. */
export function goalChartReferences(
  target: string | null,
  options: GoalOptions = defaultGoalOptions
): Pick<LineChartProps, 'referenceLines' | 'referenceAreas'> {
  if (target === null) {
    return { referenceLines: [], referenceAreas: [] };
  }
  const { lowerBound, upperBound } = evaluateGoal(null, target, options);
  const lines = new Map<number, string>();
  if (options.kind === 'target') {
    lines.set(Number(target), 'green.6');
  } else {
    if (lowerBound !== null) {
      lines.set(Number(lowerBound), 'yellow.6');
    }
    if (upperBound !== null) {
      lines.set(Number(upperBound), 'red.6');
    }
  }
  if (
    (options.kind === 'range' || options.kind === 'minimum') &&
    options.preferredTarget !== undefined
  ) {
    lines.set(Number(options.preferredTarget), 'green.6');
  }
  if (options.kind === 'minimum' && options.excellent !== undefined) {
    lines.set(Number(options.excellent), 'lime.6');
  }
  return {
    referenceLines: [...lines].map(([y, color]) => ({
      y,
      color,
      strokeDasharray: '4 4',
      ifOverflow: 'extendDomain',
    })),
    referenceAreas:
      lowerBound !== null && upperBound !== null && lowerBound !== upperBound
        ? [
            {
              y1: Number(lowerBound),
              y2: Number(upperBound),
              color: 'green.6',
              fillOpacity: 0.1,
              ifOverflow: 'extendDomain',
            },
          ]
        : [],
  };
}
