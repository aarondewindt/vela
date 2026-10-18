'use client';

import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { trpc } from '@/lib/trpc/client';
import type { MealDraft } from '@/lib/nutrition/drafts';
import type { EditDraftInput } from '@/lib/nutrition/draft-schema';
import { diaryDateSchema, formatDiaryDate } from '@/lib/nutrition/dates';
import { mealCategories, mealLabels, type MealCategory } from '@/lib/nutrition/types';
import { formatNutritionAmount } from '@/lib/nutrition/format';
import { DraftItemEditor } from './DraftItemEditor';
import { NevoAttribution } from './NevoAttribution';
import classes from './MealDraftReview.module.css';

export function MealDraftReview({
  draft,
  onSaved,
  onClosed,
  onConfirmed,
  onNotice,
}: {
  draft: MealDraft;
  onSaved: (draft: MealDraft) => Promise<void>;
  onClosed: () => void;
  onConfirmed: (date: string) => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [date, setDate] = useState(draft.date);
  const [meal, setMeal] = useState<MealCategory>(draft.mealCategory);
  const [acknowledge, setAcknowledge] = useState(false);
  const [editing, setEditing] = useState<MealDraft['items'][number] | null>(null);
  const utils = trpc.useUtils();
  const edit = trpc.nutrition.editDraft.useMutation({ retry: false, onSuccess: onSaved });
  const discard = trpc.nutrition.discardDraft.useMutation({
    retry: false,
    onSuccess: async () => {
      await utils.nutrition.listDrafts.invalidate();
      onClosed();
    },
  });
  const confirm = trpc.nutrition.confirmDraft.useMutation({
    retry: false,
    onSuccess: async (result) => {
      if (result.confirmed) {
        await onConfirmed(result.date);
        onClosed();
      } else {
        onNotice(result.notice);
        await onSaved(await utils.nutrition.getDraft.fetch({ id: draft.id }));
      }
    },
  });
  const busy = edit.isPending || discard.isPending || confirm.isPending;
  const error = edit.error ?? discard.error ?? confirm.error;
  const change = (value: EditDraftInput['change']) =>
    edit.mutate({ id: draft.id, revision: draft.revision, change: value });
  if (draft.status !== 'DRAFT') {
    return (
      <Alert color={draft.status === 'CONFIRMED' ? 'teal' : 'gray'}>
        {draft.status === 'CONFIRMED'
          ? `This draft was logged on ${formatDiaryDate(draft.date)}.`
          : 'This draft was discarded.'}
      </Alert>
    );
  }
  return (
    <Stack>
      <Title order={3}>Review meal draft</Title>
      <NevoAttribution
        sources={draft.items.flatMap((item) => (item.snapshot ? [item.snapshot.source] : []))}
      />
      <Text size="sm" c="dimmed">
        Nothing is logged until you confirm. Check the foods, date, meal and amounts.
      </Text>
      {draft.generating && (
        <Alert color="blue">
          Your message is being interpreted. Saving a manual edit supersedes that response.
        </Alert>
      )}
      <Group grow align="flex-start">
        <TextInput
          label="Draft date"
          type="date"
          min="0001-01-01"
          max="9999-12-31"
          value={date}
          onChange={(event) => setDate(event.currentTarget.value)}
        />
        <Select
          label="Draft meal"
          value={meal}
          onChange={(value) => {
            if (value) {
              setMeal(value as MealCategory);
            }
          }}
          data={mealCategories.map((value) => ({ value, label: mealLabels[value] }))}
        />
      </Group>
      <Group>
        <Button
          variant="light"
          disabled={busy || !diaryDateSchema.safeParse(date).success}
          onClick={() => change({ type: 'header', date, mealCategory: meal })}
        >
          Save date and meal
        </Button>
      </Group>
      {draft.items.length === 0 && (
        <Text c="dimmed">Describe your meal below, or add a food manually.</Text>
      )}
      {draft.items.map((item) => (
        <Paper key={item.id} withBorder p="sm" radius="md">
          <Stack gap="xs">
            <Group justify="space-between">
              <div>
                <Text fw={600} className={classes.foodName}>
                  {item.snapshot?.definition.name ?? item.query}
                </Text>
                <Text size="sm">
                  {item.quantity ?? 'Amount needed'}{' '}
                  {item.calculation?.unitLabel ?? item.unit ?? ''}
                </Text>
              </div>
              <Group gap="xs">
                <Button size="xs" variant="light" disabled={busy} onClick={() => setEditing(item)}>
                  Edit draft food
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  disabled={busy}
                  onClick={() => change({ type: 'remove', itemId: item.id })}
                >
                  Remove
                </Button>
              </Group>
            </Group>
            {item.issue && <Alert color="yellow">{item.issue}</Alert>}
            {!item.snapshot && item.searchNotice && <Text size="sm">{item.searchNotice}</Text>}
            {item.calculation && (
              <Group gap="xs">
                <Text size="sm">
                  {formatNutritionAmount(item.calculation.nutrients.calories)} kcal
                </Text>
                {item.calculation.estimated && (
                  <Badge color="yellow" size="sm">
                    Estimated conversion
                  </Badge>
                )}
              </Group>
            )}
            {!item.snapshot && item.candidates.length > 0 && (
              <div>
                <Text size="sm" c="dimmed">
                  Choose a matching product:
                </Text>
                <Group gap="xs" mt={4}>
                  {item.candidates.map((candidate) => (
                    <Button
                      key={candidate.id}
                      className={classes.candidate}
                      classNames={{ label: classes.candidateLabel }}
                      variant="default"
                      size="xs"
                      disabled={busy}
                      onClick={() =>
                        change({
                          type: 'item',
                          itemId: item.id,
                          productId: candidate.id,
                          quantity: item.quantity,
                          unit: item.unit,
                        })
                      }
                    >
                      {candidate.name}
                      {candidate.brand ? ` · ${candidate.brand}` : ''}
                    </Button>
                  ))}
                </Group>
              </div>
            )}
          </Stack>
        </Paper>
      ))}
      <Group>
        <Button
          variant="light"
          disabled={busy || draft.items.length >= 40}
          onClick={() => change({ type: 'add', query: 'New food' })}
        >
          Add food to draft
        </Button>
        <Button variant="subtle" disabled={busy} onClick={() => change({ type: 'refresh' })}>
          Refresh food definitions
        </Button>
      </Group>
      <Text fw={600}>
        Resolved foods: {formatNutritionAmount(draft.totals.calories)} kcal · P{' '}
        {formatNutritionAmount(draft.totals.protein)} g · C{' '}
        {formatNutritionAmount(draft.totals.carbohydrates)} g · F{' '}
        {formatNutritionAmount(draft.totals.fat)} g
      </Text>
      {draft.unresolved > 0 && (
        <Text c="dimmed" size="sm">
          {draft.unresolved} food{draft.unresolved === 1 ? '' : 's'} still need attention. Totals
          include resolved foods only.
        </Text>
      )}
      {draft.questions.length > 0 && (
        <Alert color="yellow" title="Check before confirming">
          <Stack gap="xs">
            {draft.questions.map((question, index) => (
              <Text size="sm" key={index}>
                {question}
              </Text>
            ))}
            <Checkbox
              label="I reviewed these questions and the draft is correct"
              checked={acknowledge}
              onChange={(event) => setAcknowledge(event.currentTarget.checked)}
            />
          </Stack>
        </Alert>
      )}
      {error && <Alert color="red">{error.message}</Alert>}
      <Group justify="space-between">
        <Button
          variant="subtle"
          color="red"
          disabled={busy}
          onClick={() =>
            modals.openConfirmModal({
              title: 'Discard this meal draft?',
              children: <Text>This closes the draft without logging any food.</Text>,
              labels: { confirm: 'Discard draft', cancel: 'Keep draft' },
              onConfirm: () => discard.mutate({ id: draft.id, revision: draft.revision }),
            })
          }
        >
          Discard draft
        </Button>
        <Button
          loading={confirm.isPending}
          disabled={
            busy ||
            draft.generating ||
            !draft.items.length ||
            draft.unresolved > 0 ||
            (draft.questions.length > 0 && !acknowledge) ||
            date !== draft.date ||
            meal !== draft.mealCategory
          }
          onClick={() =>
            confirm.mutate({
              id: draft.id,
              revision: draft.revision,
              acknowledgeQuestions: acknowledge,
            })
          }
        >
          Confirm and log meal
        </Button>
      </Group>
      {editing && (
        <DraftItemEditor
          draft={draft}
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </Stack>
  );
}
