'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Button,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { trpc } from '@/lib/trpc/client';
import {
  dateInTimezone,
  diaryDateSchema,
  formatDiaryDate,
  shiftDiaryDate,
} from '@/lib/nutrition/dates';
import { mealCategories, type MealCategory } from '@/lib/nutrition/types';
import type { DiaryEntry } from '@/lib/nutrition/diary';
import { DailyNutritionSummary } from './DailyNutritionSummary';
import { MealSection } from './MealSection';
import { LogEntryEditor } from './LogEntryEditor';
import { MealDraftComposer } from './MealDraftComposer';
import { RecipeFromMealDialog } from './RecipeFromMealDialog';
import { CopyMealDialog } from './CopyMealDialog';
import classes from './NutritionDiaryView.module.css';

export function NutritionDiaryView({
  initialDate,
  timezone,
  initialDraftId,
}: {
  initialDate: string;
  timezone: string;
  initialDraftId?: string;
}) {
  const utils = trpc.useUtils();
  const [date, setDate] = useState(initialDate);
  const [recipeEntries, setRecipeEntries] = useState<DiaryEntry[] | null>(null);
  const [copyMeal, setCopyMeal] = useState<MealCategory | null>(null);
  const [editor, setEditor] = useState<{ entry: DiaryEntry | null; meal: MealCategory } | null>(
    null
  );
  const valid = diaryDateSchema.safeParse(date).success;
  const diary = trpc.nutrition.getDiary.useQuery(
    { date },
    { enabled: valid, retry: false, refetchOnMount: 'always' }
  );
  const current = valid && diary.isFetchedAfterMount && !diary.error ? diary.data : undefined;
  const refresh = async () => {
    await Promise.all([
      utils.nutrition.getDiary.invalidate(),
      utils.nutrition.getHistory.invalidate(),
      utils.nutrition.productSuggestions.invalidate(),
    ]);
  };
  const remove = trpc.nutrition.deleteLogEntry.useMutation({ onSuccess: refresh });
  const changeDate = (value: string) => {
    setDate(value);
    if (diaryDateSchema.safeParse(value).success) {
      const url = new URL(window.location.href);
      url.searchParams.set('date', value);
      window.history.replaceState(null, '', url);
    }
  };
  const removeEntry = (entry: DiaryEntry) =>
    modals.openConfirmModal({
      title: `Remove ${entry.productName}?`,
      children: (
        <Text>This removes the entry from your diary for {formatDiaryDate(entry.logDate)}.</Text>
      ),
      labels: { confirm: 'Remove food entry', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate({ id: entry.id, version: entry.version }),
    });
  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Group justify="space-between">
          <div>
            <Title order={2}>Nutrition diary</Title>
            <Text c="dimmed" mt={4}>
              Your food and nutrition, one day at a time.
            </Text>
          </div>
          <Group gap="xs">
            <Button component={Link} href={`/nutrition/history?date=${date}`} variant="light">
              History
            </Button>
            <Button component={Link} href={`/nutrition/settings?date=${date}`} variant="default">
              Daily goals
            </Button>
          </Group>
        </Group>
        <Group>
          <Button
            variant="default"
            aria-label="Previous day"
            disabled={!valid || date === '0001-01-01'}
            onClick={() => changeDate(shiftDiaryDate(date, -1))}
          >
            ←
          </Button>
          <TextInput
            className={classes.dateControl}
            type="date"
            aria-label="Diary date"
            min="0001-01-01"
            max="9999-12-31"
            value={date}
            onChange={(event) => changeDate(event.currentTarget.value)}
          />
          <Button
            variant="default"
            aria-label="Next day"
            disabled={!valid || date === '9999-12-31'}
            onClick={() => changeDate(shiftDiaryDate(date, 1))}
          >
            →
          </Button>
          <Button variant="subtle" onClick={() => changeDate(dateInTimezone(timezone))}>
            Today
          </Button>
        </Group>
        {valid ? (
          <Text fw={500}>{formatDiaryDate(date)}</Text>
        ) : (
          <Alert color="yellow">Choose a valid calendar date.</Alert>
        )}
        {valid && !current && !diary.error && (
          <Group role="status">
            <Loader size="sm" />
            <Text>Loading diary…</Text>
          </Group>
        )}
        {diary.error && (
          <Alert color="red" title="Could not load diary">
            <Text>{diary.error.message}</Text>
            <Button variant="light" onClick={() => void diary.refetch()}>
              Retry loading diary
            </Button>
          </Alert>
        )}
        {remove.error && (
          <Alert color="red" title="Could not remove food entry">
            {remove.error.message}
          </Alert>
        )}
        {current && (
          <>
            <DailyNutritionSummary day={current} />
            <MealDraftComposer
              date={date}
              initialDraftId={initialDraftId}
              onConfirmed={async (targetDate) => {
                changeDate(targetDate);
                await refresh();
              }}
            />
            {mealCategories.map((meal) => (
              <MealSection
                key={meal}
                meal={meal}
                entries={current.entries.filter((entry) => entry.mealCategory === meal)}
                removing={remove.isPending}
                onAdd={() => setEditor({ entry: null, meal })}
                onCopy={() => setCopyMeal(meal)}
                onCreateRecipe={() =>
                  setRecipeEntries(current.entries.filter((entry) => entry.mealCategory === meal))
                }
                onEdit={(entry) => setEditor({ entry, meal })}
                onRemove={removeEntry}
              />
            ))}
            <Text c="dimmed" size="xs">
              Dates follow your {timezone} calendar. Saved entries retain their original nutrition
              values.
            </Text>
          </>
        )}
      </Stack>
      {editor && (
        <LogEntryEditor
          entry={editor.entry}
          date={date}
          mealCategory={editor.meal}
          onClose={() => setEditor(null)}
          onSaved={async (entry) => {
            changeDate(entry.logDate);
            await refresh();
          }}
        />
      )}
      {recipeEntries && (
        <RecipeFromMealDialog
          entries={recipeEntries}
          onClose={() => setRecipeEntries(null)}
          onSaved={async () => {
            await Promise.all([
              utils.nutrition.listProducts.invalidate(),
              utils.nutrition.searchProducts.invalidate(),
              utils.nutrition.productSuggestions.invalidate(),
            ]);
          }}
        />
      )}
      {copyMeal && (
        <CopyMealDialog
          date={date}
          meal={copyMeal}
          onClose={() => setCopyMeal(null)}
          onSaved={refresh}
        />
      )}
    </Container>
  );
}
