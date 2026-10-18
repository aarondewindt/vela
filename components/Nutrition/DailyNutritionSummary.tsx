'use client';

import { Paper, Progress, SimpleGrid, Stack, Text } from '@mantine/core';
import type { nutritionDiary } from '@/lib/nutrition/diary';
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
                    {progress.goal ? `/ ${amount(progress.goal)} ` : ''}
                    {unit}
                  </Text>
                </Text>
                {progress.percent !== null ? (
                  <>
                    <Progress
                      value={progress.percent}
                      color={progress.exceeded ? 'orange' : 'teal'}
                      aria-label={`${labels[key]} goal progress`}
                    />
                    <Text size="xs" c="dimmed">
                      {progress.exceeded
                        ? 'Above goal'
                        : `${amount(progress.remaining!)} ${unit} remaining`}
                    </Text>
                  </>
                ) : (
                  <Text size="xs" c="dimmed">
                    No goal set
                  </Text>
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
