'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import { diaryDateSchema, shiftDiaryDate } from '@/lib/nutrition/dates';
import { mealCategories, mealLabels, type MealCategory } from '@/lib/nutrition/types';
import { formatNutritionAmount } from '@/lib/nutrition/format';

export function CopyMealDialog({
  date,
  meal,
  onClose,
  onSaved,
}: {
  date: string;
  meal: MealCategory;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [sourceDate, setSourceDate] = useState(() =>
    date === '0001-01-01' ? date : shiftDiaryDate(date, -1)
  );
  const [sourceMeal, setSourceMeal] = useState(meal);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const valid = diaryDateSchema.safeParse(sourceDate).success;
  const source = trpc.nutrition.getDiary.useQuery(
    { date: sourceDate },
    { enabled: valid, retry: false, refetchOnMount: 'always' }
  );
  const copy = trpc.nutrition.copyMeal.useMutation({ retry: false });
  const entries = source.data?.entries.filter((entry) => entry.mealCategory === sourceMeal) ?? [];
  const ids = selected ?? entries.map((entry) => entry.id);
  const changedSelection = () => {
    copy.reset();
    setRequestId(crypto.randomUUID());
  };
  const same = date === sourceDate && meal === sourceMeal;
  return (
    <Modal
      opened
      title={`Copy food to ${mealLabels[meal]}`}
      closeButtonProps={{ 'aria-label': 'Close meal copy' }}
      onClose={() => {
        if (!copy.isPending) {
          onClose();
        }
      }}
      closeOnClickOutside={!copy.isPending}
      closeOnEscape={!copy.isPending}
    >
      <Stack>
        <Text size="sm" c="dimmed">
          Select foods from a previous meal. Their recorded nutrition is copied unchanged.
        </Text>
        <TextInput
          type="date"
          label="Copy from date"
          min="0001-01-01"
          max="9999-12-31"
          value={sourceDate}
          disabled={copy.isPending}
          onChange={(event) => {
            setSourceDate(event.currentTarget.value);
            setSelected(null);
            changedSelection();
          }}
        />
        <Select
          label="Copy from meal"
          value={sourceMeal}
          allowDeselect={false}
          disabled={copy.isPending}
          data={mealCategories.map((value) => ({ value, label: mealLabels[value] }))}
          onChange={(value) => {
            if (value) {
              setSourceMeal(value as MealCategory);
              setSelected(null);
              changedSelection();
            }
          }}
        />
        {source.isFetching && <Loader size="sm" />}
        {source.error && (
          <Alert color="red">
            {source.error.message}
            <Button variant="subtle" onClick={() => void source.refetch()}>
              Retry source meal
            </Button>
          </Alert>
        )}
        {!source.isFetching && !source.error && !entries.length && (
          <Text c="dimmed">No food in this meal.</Text>
        )}
        {entries.map((entry) => (
          <Checkbox
            key={entry.id}
            checked={ids.includes(entry.id)}
            disabled={copy.isPending}
            label={`${entry.productName} · ${entry.quantity} ${entry.unitLabel} · ${formatNutritionAmount(entry.nutrients.calories)} kcal`}
            onChange={(event) => {
              setSelected(
                event.currentTarget.checked
                  ? [...ids, entry.id]
                  : ids.filter((id) => id !== entry.id)
              );
              changedSelection();
            }}
          />
        ))}
        {same && <Alert color="yellow">Choose a different source meal or date.</Alert>}
        {copy.error && <Alert color="red">{copy.error.message}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" disabled={copy.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={copy.isPending}
            disabled={!valid || same || !ids.length || source.isFetching || Boolean(source.error)}
            onClick={async () => {
              try {
                await copy.mutateAsync({
                  requestId,
                  sourceDate,
                  targetDate: date,
                  sourceMeal,
                  targetMeal: meal,
                  entries: entries
                    .filter((entry) => ids.includes(entry.id))
                    .map((entry) => ({ id: entry.id, version: entry.version })),
                });
              } catch {
                return;
              }
              await onSaved();
              onClose();
            }}
          >
            Copy selected foods
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
