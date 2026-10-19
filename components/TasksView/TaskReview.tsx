'use client';

import { useState } from 'react';
import { Alert, Button, Checkbox, Divider, Group, Stack, Text } from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import { focusScale, suggestionFields, type ReviewDocument } from '@/lib/task-reviews/schema';
import { taskSizeLabel, planningCategoryLabels, type ThemeRow } from '@/lib/planner/tasks';

type Field = (typeof suggestionFields)[number];
const labels: Record<Field, string> = {
  priority: 'Priority',
  size: 'Size',
  estimatedMinutes: 'Estimated effort',
  firstStep: 'First step',
  themeId: 'Theme',
  category: 'Category',
  brief: 'Brief',
  tags: 'Tags',
};

function suggestionLabel(
  field: Field,
  value: string | number | string[] | null,
  themes: Pick<ThemeRow, 'id' | 'name'>[]
) {
  if (value === null) {
    return 'Unknown';
  }
  switch (field) {
    case 'priority':
      return `P${value}`;
    case 'size':
      return taskSizeLabel(Number(value));
    case 'estimatedMinutes':
      return `${value} min total`;
    case 'themeId':
      return value === 'NONE'
        ? 'No theme'
        : (themes.find((theme) => theme.id === value)?.name ?? 'Unavailable theme');
    case 'category':
      return value === 'INHERIT'
        ? 'Use theme default'
        : planningCategoryLabels[value as keyof typeof planningCategoryLabels];
    case 'tags':
      return (value as string[]).join(', ') || 'No tags';
    case 'brief':
      return value === '' ? 'Clear brief' : value;
    default:
      return value;
  }
}

export function TaskReview({
  taskId,
  themes = [],
}: {
  taskId: string;
  themes?: Pick<ThemeRow, 'id' | 'name'>[];
}) {
  const utils = trpc.useUtils();
  const latest = trpc.taskReviews.latest.useQuery({ taskId }, { refetchInterval: 30000 });
  const generate = trpc.taskReviews.generate.useMutation({
    onSuccess: () => utils.taskReviews.latest.invalidate({ taskId }),
  });
  const accept = trpc.taskReviews.accept.useMutation({
    onSuccess: () =>
      Promise.all([
        utils.taskReviews.latest.invalidate({ taskId }),
        utils.planner.listTasks.invalidate(),
        utils.planner.getDayData.invalidate(),
      ]),
    onError: () => utils.taskReviews.latest.invalidate({ taskId }),
  });
  const review = latest.data;
  const error = latest.error ?? generate.error ?? accept.error;
  return (
    <Stack gap="sm" mt="md">
      <Divider label="AI task review" />
      <Text size="xs" c="dimmed">
        AI assessments are suggestions. Choose which properties to apply.
      </Text>
      <Button
        variant="light"
        loading={generate.isPending}
        disabled={accept.isPending}
        onClick={() => generate.mutate({ taskId })}
      >
        {review ? 'Regenerate task review' : 'Review task'}
      </Button>
      {error && (
        <Alert color="red" role="alert">
          {error.message}
        </Alert>
      )}
      {latest.isPending && <Text size="sm">Loading review…</Text>}
      {review && (
        <>
          <Text size="xs" c="dimmed">
            {review.modelId} · {review.createdAt.toLocaleString()}
          </Text>
          {review.outdated && (
            <Alert color="yellow">
              Outdated review: source information or the assessment date changed. Regenerate before
              applying.
            </Alert>
          )}
          {review.acceptedAt && (
            <Text size="sm">
              Applied: {review.acceptedFields.map((field) => labels[field as Field]).join(', ')}.
            </Text>
          )}
          <Text size="sm" fw={600}>
            AI context summary
          </Text>
          <Text size="sm">{review.document.summary}</Text>
          {(
            [
              ['Recorded facts', review.document.recordedFacts],
              ['Inferred context', review.document.inferredContext],
              ['Missing information', review.document.missingInformation],
              ['Next steps', review.document.nextSteps],
            ] as const
          ).map(([title, items]) => (
            <Stack key={title} gap={4}>
              <Text size="sm" fw={600}>
                {title}
              </Text>
              {items.length ? (
                items.map((item, i) => (
                  <Text size="sm" key={i}>
                    • {item}
                  </Text>
                ))
              ) : (
                <Text size="sm" c="dimmed">
                  None identified.
                </Text>
              )}
            </Stack>
          ))}
          <Text size="sm" fw={600}>
            Focus: {review.document.focus.value}/5
          </Text>
          <Text size="sm">{review.document.focus.explanation}</Text>
          <details>
            <summary>Focus scale</summary>
            {focusScale.map((line) => (
              <Text size="xs" key={line}>
                {line}
              </Text>
            ))}
          </details>
          <Text size="sm" fw={600}>
            Due-date risk: {review.document.dueDateRisk.value}
          </Text>
          <Text size="sm">{review.document.dueDateRisk.explanation}</Text>
          <Text size="sm" fw={600}>
            Blockers and ways forward
          </Text>
          {review.document.blockers.length ? (
            review.document.blockers.map((item, i) => (
              <Text size="sm" key={i}>
                {item.blocker} — {item.unblock}
              </Text>
            ))
          ) : (
            <Text size="sm" c="dimmed">
              None identified; this does not confirm there are no blockers.
            </Text>
          )}
          <ReviewSuggestions
            key={review.id}
            document={review.document}
            themes={themes}
            disabled={review.outdated || !!review.acceptedAt || generate.isPending}
            pending={accept.isPending}
            onAccept={(fields) => accept.mutate({ id: review.id, fields })}
          />
        </>
      )}
    </Stack>
  );
}

export function ReviewSuggestions({
  document,
  disabled,
  pending,
  onAccept,
  themes = [],
}: {
  themes?: Pick<ThemeRow, 'id' | 'name'>[];
  document: ReviewDocument;
  disabled: boolean;
  pending: boolean;
  onAccept: (fields: Field[]) => void;
}) {
  const [selected, setSelected] = useState<Field[]>([]);
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Suggested properties
      </Text>
      {suggestionFields.map((field) => {
        const suggestion = document[field];
        if (!suggestion) {
          return null;
        }
        const { value, explanation } = suggestion;
        const display = suggestionLabel(field, value, themes);
        return (
          <Stack gap={2} key={field}>
            <Checkbox
              label={`${labels[field]}: ${display}`}
              checked={selected.includes(field)}
              disabled={disabled || pending || value === null}
              onChange={(event) =>
                setSelected(
                  event.currentTarget.checked
                    ? [...selected, field]
                    : selected.filter((item) => item !== field)
                )
              }
            />
            <Text size="xs" c="dimmed">
              {explanation}
            </Text>
          </Stack>
        );
      })}
      <Group>
        <Button
          size="xs"
          disabled={disabled || !selected.length}
          loading={pending}
          onClick={() => onAccept(selected)}
        >
          Apply selected suggestions
        </Button>
      </Group>
    </Stack>
  );
}
