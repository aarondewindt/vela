'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Group, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { GoalProgress } from '@/components/Goals/GoalProgress';
import { describeGoal, goalStatusLabels } from '@/lib/goals/semantics';
import { dateInTimezone } from '@/lib/nutrition/dates';
import { formatNutritionAmount } from '@/lib/nutrition/format';
import { trpc } from '@/lib/trpc/client';

const macros = [
  ['protein', 'Protein'],
  ['carbohydrates', 'Carbohydrates'],
  ['fat', 'Fat'],
] as const;

export function NutritionGoalsWidget({
  initialDate,
  timezone,
}: {
  initialDate: string;
  timezone: string;
}) {
  const [date, setDate] = useState(initialDate);
  useEffect(() => {
    const updateDate = () => setDate(dateInTimezone(timezone));
    updateDate();
    const timer = setInterval(updateDate, 60_000);
    return () => clearInterval(timer);
  }, [timezone]);
  const diary = trpc.nutrition.getDiary.useQuery(
    { date },
    { retry: false, refetchInterval: 60_000 }
  );
  return (
    <Paper withBorder p="md" radius="md" maw={560} w="100%">
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={3}>Nutrition goals</Title>
          <Button component={Link} href={`/nutrition?date=${date}`} variant="subtle" size="xs">
            Open diary
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          Logged intake · {date}
        </Text>
        {diary.isLoading && <Loader size="sm" aria-label="Loading nutrition goals" />}
        {diary.error && (
          <Alert color="red">
            <Text size="sm">{diary.error.message}</Text>
            <Button variant="subtle" size="xs" onClick={() => void diary.refetch()}>
              Retry
            </Button>
          </Alert>
        )}
        {!diary.error && diary.data && (
          <>
            {diary.data.entries.length === 0 && (
              <Text size="sm" c="dimmed">
                No food logged today.
              </Text>
            )}
            {macros.map(([key, label]) => {
              const progress = diary.data.progress[key];
              return (
                <Stack key={key} gap={4}>
                  <Group justify="space-between">
                    <Text size="sm" fw={500}>
                      {label}
                    </Text>
                    <Text size="sm">
                      {progress.consumed === null
                        ? 'Unknown'
                        : formatNutritionAmount(progress.consumed)}{' '}
                      g
                    </Text>
                  </Group>
                  <GoalProgress
                    label={label}
                    value={progress.consumed}
                    target={progress.goal}
                    options={progress.options}
                    unit="g"
                    compact
                  />
                  <Text size="xs" c="dimmed">
                    {describeGoal(progress.goal, progress.options)}
                    {progress.goal === null ? '' : ' g'}
                    {progress.goal !== null && ` · ${goalStatusLabels[progress.evaluation.status]}`}
                  </Text>
                </Stack>
              );
            })}
            <Text size="xs" c="dimmed">
              Based on recorded food; today may be incomplete.
            </Text>
          </>
        )}
        <Button
          component={Link}
          href="/settings/nutrition"
          variant="default"
          size="xs"
          maw="fit-content"
        >
          Configure goals
        </Button>
      </Stack>
    </Paper>
  );
}
