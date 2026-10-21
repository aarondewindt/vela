'use client';

import { Box, Progress } from '@mantine/core';
import { describeGoal, goalStatusLabels, type GoalOptions } from '@/lib/goals/semantics';
import { goalProgressScale } from '@/lib/goals/progress';
import classes from './GoalProgress.module.css';

export function GoalProgress({
  label,
  value,
  target,
  options,
  unit,
}: {
  label: string;
  value: string | null;
  target: string | null;
  options: GoalOptions;
  unit: string;
}) {
  const scale = goalProgressScale(value, target, options);
  if (!scale) {
    return null;
  }
  const description = `${describeGoal(target, options)} ${unit}`;
  return (
    <Box className={classes.root} title={`${description}; ${goalStatusLabels[scale.status]}`}>
      <Progress.Root size="md">
        <Progress.Section
          value={scale.fill}
          color={scale.color}
          withAria={false}
          role="progressbar"
          aria-label={`${label} goal progress`}
          aria-valuemin={0}
          aria-valuemax={scale.maximum}
          aria-valuenow={Number(value)}
          aria-valuetext={`${value} ${unit}; ${description}; ${goalStatusLabels[scale.status]}`}
        />
      </Progress.Root>
      {scale.lower !== null && scale.upper !== null && scale.lower < scale.upper && (
        <span
          aria-hidden="true"
          className={classes.band}
          style={{ left: `${scale.lower}%`, width: `${scale.upper - scale.lower}%` }}
        />
      )}
      {(options.kind === 'range' || options.kind === 'minimum'
        ? [scale.lower, scale.target, scale.upper, scale.excellent].filter(
            (position) => position !== null
          )
        : [scale.target]
      ).map((position, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={classes.marker}
          style={{ left: `${position}%` }}
        />
      ))}
    </Box>
  );
}
