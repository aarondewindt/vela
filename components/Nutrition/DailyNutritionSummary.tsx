'use client';

import { Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import type { nutritionDiary } from '@/lib/nutrition/diary';
import { GoalProgress } from '@/components/Goals/GoalProgress';
import { goalProgressScale } from '@/lib/goals/progress';
import { describeGoal, goalStatusLabels } from '@/lib/goals/semantics';
import { goalKeys } from '@/lib/nutrition/types';
import { formatNutritionAmount as amount } from '@/lib/nutrition/format';
import { NevoAttribution } from './NevoAttribution';
import { snapshotSources } from '@/lib/nutrition/attribution';

const labels = {
  calories: 'Calories',
  protein: 'Protein',
  carbohydrates: 'Carbohydrates',
  fat: 'Fat',
};

export function DailyNutritionSummary({
  day,
}: {
  day: Awaited<ReturnType<typeof nutritionDiary.day>>;
}) {
  return (
    <Stack gap="xs">
      <NevoAttribution sources={day.entries.flatMap((entry) => snapshotSources(entry.snapshot))} />
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        {goalKeys.map((key) => {
          const progress = day.progress[key];
          const unit = key === 'calories' ? 'kcal' : 'g';
          return (
            <Paper key={key} withBorder p="md" radius="md">
              <Stack gap="xs">
                <Text c="dimmed" size="sm">
                  {labels[key]}
                </Text>
                <Text fw={700} size="xl" style={{ overflowWrap: 'anywhere' }}>
                  {amount(progress.consumed)}{' '}
                  <Text component="span" size="sm" c="dimmed">
                    {unit}
                  </Text>
                </Text>
                <Text size="xs" c="dimmed">
                  {describeGoal(progress.goal, progress.options)}
                  {progress.goal !== null ? ` ${unit}` : ''}
                </Text>
                {progress.goal !== null && (
                  <>
                    <GoalProgress
                      label={labels[key]}
                      value={progress.consumed}
                      target={progress.goal}
                      options={progress.options}
                      unit={unit}
                    />
                    <Text
                      size="xs"
                      c={
                        goalProgressScale(progress.consumed, progress.goal, progress.options)
                          ?.color ?? 'dimmed'
                      }
                    >
                      {goalStatusLabels[progress.evaluation.status]}
                    </Text>
                  </>
                )}
              </Stack>
            </Paper>
          );
        })}
      </SimpleGrid>
      {day.entries.length > 0 && (
        <Text size="xs" c="dimmed">
          {day.totals.fiberIncomplete
            ? `Fiber: at least ${amount(day.totals.knownFiber)} g (some entries have unknown fiber).`
            : `Fiber: ${amount(day.totals.fiber!)} g`}
        </Text>
      )}
    </Stack>
  );
}
