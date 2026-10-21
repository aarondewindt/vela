'use client';

import Link from 'next/link';
import {
  Alert,
  Anchor,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import { GoalProgress } from '@/components/Goals/GoalProgress';
import { describeGoal, goalStatusLabels, type GoalOptions } from '@/lib/goals/semantics';
import { formatNutritionAmount as amount } from '@/lib/nutrition/format';
import classes from './DashboardNutrition.module.css';

function goalAmount(target: string, options: GoalOptions) {
  const base = amount(target);
  switch (options.kind) {
    case 'minimum':
      return `≥${base}`;
    case 'maximum':
      return `≤${base}`;
    case 'range':
      return `${base}–${amount(options.upperBound)}`;
    case 'target':
      return `${base}${options.tolerance ? `±${amount(options.tolerance)}` : ''}`;
  }
}

export function DashboardNutrition({ date }: { date: string }) {
  const diary = trpc.nutrition.getDiary.useQuery(
    { date },
    { retry: false, refetchInterval: 30000, refetchOnMount: 'always' }
  );
  const current = diary.isFetchedAfterMount && !diary.error ? diary.data : undefined;
  return (
    <Paper withBorder p="sm" className={classes.widget}>
      <Stack gap="xs">
        <Group justify="space-between" gap="xs">
          <Title order={2} size="h5">
            Today's nutrition
          </Title>
          <Text size="xs" c="dimmed">
            {date}
          </Text>
        </Group>
        {!current && !diary.error && <Loader aria-label="Loading today's nutrition" />}
        {diary.error && (
          <Alert color="red">
            {diary.error.message}
            <Button variant="subtle" onClick={() => void diary.refetch()}>
              Retry nutrition
            </Button>
          </Alert>
        )}
        {current && (
          <>
            <Text
              size="xs"
              c="dimmed"
              title={describeGoal(
                current.progress.calories.goal,
                current.progress.calories.options
              )}
            >
              {amount(current.totals.calories)}
              {current.progress.calories.goal !== null &&
                ` / ${goalAmount(current.progress.calories.goal, current.progress.calories.options)}`}{' '}
              kcal logged · Intake so far
            </Text>
            {(
              [
                ['protein', 'Protein'],
                ['carbohydrates', 'Carbs'],
                ['fat', 'Fat'],
                ['fiber', 'Fiber'],
              ] as const
            ).map(([key, label]) => {
              const progress = current.progress[key];
              const description = `${describeGoal(progress.goal, progress.options)}${progress.goal === null ? '' : ' g'}; ${goalStatusLabels[progress.evaluation.status]}`;
              return (
                <Box key={key} className={classes.row} title={description}>
                  <Text size="xs">{label}</Text>
                  <Box>
                    {progress.goal === null ? (
                      <Text size="xs" c="dimmed">
                        No goal
                      </Text>
                    ) : (
                      <GoalProgress
                        label={label}
                        value={progress.consumed}
                        target={progress.goal}
                        options={progress.options}
                        unit="g"
                        compact
                      />
                    )}
                  </Box>
                  <Text size="xs" className={classes.amount}>
                    {progress.consumed === null ? 'Unknown' : amount(progress.consumed)}
                    {progress.goal !== null &&
                      ` / ${goalAmount(progress.goal, progress.options)}`}{' '}
                    g
                  </Text>
                </Box>
              );
            })}
            {current.totals.fiberIncomplete && (
              <Text size="xs" c="dimmed">
                Fiber: at least {amount(current.totals.knownFiber)} g; some entries are unknown.
              </Text>
            )}
          </>
        )}
        <Group gap="md">
          <Anchor component={Link} href={`/nutrition?date=${date}`} size="xs">
            Open nutrition diary
          </Anchor>
          <Anchor component={Link} href="/settings/nutrition" size="xs">
            Edit nutrition goals
          </Anchor>
        </Group>
      </Stack>
    </Paper>
  );
}
