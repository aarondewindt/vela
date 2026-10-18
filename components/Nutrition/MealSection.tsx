'use client';

import { Badge, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import type { DiaryEntry } from '@/lib/nutrition/diary';
import { mealLabels, type MealCategory } from '@/lib/nutrition/types';
import classes from './NutritionDiaryView.module.css';
import { formatNutritionAmount as amount } from '@/lib/nutrition/format';

export function MealSection({
  meal,
  entries,
  removing,
  onAdd,
  onEdit,
  onRemove,
}: {
  meal: MealCategory;
  entries: DiaryEntry[];
  removing: boolean;
  onAdd: () => void;
  onEdit: (entry: DiaryEntry) => void;
  onRemove: (entry: DiaryEntry) => void;
}) {
  return (
    <Paper withBorder p="md" radius="md">
      <Stack>
        <Group justify="space-between">
          <Title order={3}>{mealLabels[meal]}</Title>
          <Button
            size="xs"
            variant="light"
            aria-label={`Add food to ${mealLabels[meal]}`}
            onClick={onAdd}
          >
            Add food
          </Button>
        </Group>
        {entries.length === 0 && (
          <Text c="dimmed" size="sm">
            No food logged yet.
          </Text>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className={classes.entry}>
            <div className={classes.entryDescription}>
              <Text fw={500} className={classes.productName}>
                {entry.productName}
              </Text>
              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  {entry.quantity} {entry.unitLabel}
                </Text>
                {entry.estimated && (
                  <Badge size="xs" color="yellow" variant="light">
                    Estimated conversion
                  </Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                Protein {amount(entry.nutrients.protein)} g · Carbs{' '}
                {amount(entry.nutrients.carbohydrates)} g · Fat {amount(entry.nutrients.fat)} g
              </Text>
            </div>
            <Stack gap="xs" align="flex-end">
              <Text fw={600}>{amount(entry.nutrients.calories)} kcal</Text>
              <Group gap="xs" wrap="nowrap">
                <Button
                  size="compact-xs"
                  variant="subtle"
                  aria-label={`Edit ${entry.productName}`}
                  onClick={() => onEdit(entry)}
                >
                  Edit
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="red"
                  disabled={removing}
                  aria-label={`Remove ${entry.productName}`}
                  onClick={() => onRemove(entry)}
                >
                  Remove
                </Button>
              </Group>
            </Stack>
          </div>
        ))}
      </Stack>
    </Paper>
  );
}
