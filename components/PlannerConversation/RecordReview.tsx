'use client';
import { useState } from 'react';
import { Alert, Button, Checkbox, Stack, Text } from '@mantine/core';
import { planningCategoryLabels, taskSizeLabel, taskStatusLabels } from '@/lib/planner/tasks';
import type { RecordPreview } from '@/lib/planner/conversation/schema';

export function RecordReview({
  preview,
  accepted,
  active,
  busy,
  accept,
}: {
  preview: RecordPreview;
  accepted: boolean;
  active: boolean;
  busy: boolean;
  accept: (confirmed: boolean) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const deleted = preview.action === 'delete';
  const fields = deleted
    ? Object.entries(preview.before ?? {}).filter(([key]) =>
        ['id', 'title', 'name', 'status', 'themeId'].includes(key)
      )
    : Object.entries(preview.patch);
  const labels: Record<string, string> = {
    id: 'Record ID',
    title: 'Title',
    brief: 'Brief',
    status: 'Status',
    priority: 'Priority',
    size: 'Size',
    dueDate: 'Due date',
    estimatedMinutes: 'Estimate (minutes)',
    leadTimeDays: 'Lead time (days)',
    themeId: 'Theme',
    category: 'Category',
    tags: 'Tags',
    name: 'Name',
    color: 'Color',
    isActive: 'Active',
  };
  const display = (value: unknown, key: string): string => {
    if (value === null || value === undefined) {
      return 'Clear / inherit';
    }
    if (key === 'themeId' && typeof value === 'string') {
      return preview.references?.[value] ?? value;
    }
    if (key === 'priority') {
      return `P${value}`;
    }
    if (key === 'size' && typeof value === 'number') {
      return taskSizeLabel(value);
    }
    if (key === 'status') {
      return taskStatusLabels[value as keyof typeof taskStatusLabels] ?? String(value);
    }
    if (key === 'category') {
      return planningCategoryLabels[value as keyof typeof planningCategoryLabels] ?? String(value);
    }
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }
    return Array.isArray(value) ? value.join(', ') : String(value);
  };

  return (
    <Stack gap="xs">
      <Text fw={600}>
        {preview.action} {preview.entity}:{' '}
        {String(
          preview.before?.title ??
            preview.before?.name ??
            preview.patch.title ??
            preview.patch.name ??
            ''
        )}
      </Text>
      {fields.map(([key, value]) => (
        <Text size="sm" key={key}>
          {labels[key] ?? key}:{' '}
          {preview.before && !deleted ? `${display(preview.before[key], key)} → ` : ''}
          {display(value, key)}
        </Text>
      ))}
      {preview.warnings.map((warning) => (
        <Alert color="yellow" key={warning}>
          {warning}
        </Alert>
      ))}
      {accepted ? (
        <Text role="status">Changes accepted.</Text>
      ) : (
        active && (
          <>
            {deleted && (
              <Checkbox
                label={`I confirm deletion of this ${preview.entity}`}
                checked={confirmed}
                onChange={(event) => setConfirmed(event.currentTarget.checked)}
                disabled={busy}
              />
            )}
            <Button
              color={deleted ? 'red' : undefined}
              disabled={busy || (deleted && !confirmed)}
              onClick={() => accept(confirmed)}
            >
              {deleted ? 'Confirm deletion' : 'Accept changes'}
            </Button>
          </>
        )
      )}
    </Stack>
  );
}
