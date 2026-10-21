import type { ChartReferenceAreaProps, ChartReferenceLineProps } from '@mantine/charts';
import { evaluateGoal, type GoalOptions } from './semantics';

/** Resolve configured bounds independently of observations, including signed/zero goals. */
export function goalChartReferences(target: string | null, options: GoalOptions) {
  const referenceAreas: ChartReferenceAreaProps[] = [];
  const referenceLines: ChartReferenceLineProps[] = [];
  if (target === null) {
    return { referenceAreas, referenceLines };
  }
  const evaluation = evaluateGoal(null, target, options);
  const lower = evaluation.lowerBound === null ? undefined : Number(evaluation.lowerBound);
  const upper = evaluation.upperBound === null ? undefined : Number(evaluation.upperBound);
  if (lower !== upper) {
    referenceAreas.push({
      y1: lower,
      y2: upper,
      color: 'green.6',
      fillOpacity: 0.1,
      strokeOpacity: 0,
      ifOverflow: 'extendDomain',
    });
  }
  const preferred =
    options.kind === 'range' || options.kind === 'minimum'
      ? options.preferredTarget
      : options.kind === 'target'
        ? target
        : undefined;
  const boundaries = [lower, upper, preferred === undefined ? undefined : Number(preferred)];
  for (const y of new Set(boundaries)) {
    if (y !== undefined) {
      referenceLines.push({
        y,
        color: 'green.6',
        strokeDasharray: '4 4',
        ifOverflow: 'extendDomain',
      });
    }
  }
  return { referenceAreas, referenceLines };
}
