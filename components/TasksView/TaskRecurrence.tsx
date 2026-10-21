'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Stack, Switch, Text, TextInput } from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import { useUpdateTaskMutation } from '@/lib/planner/query';
import { taskRecurrenceSchema } from '@/lib/planner/record-schema';
import type { TaskRow } from '@/lib/planner/tasks';

export function TaskRecurrence({
  task,
  onSaved,
  onPendingChange,
}: {
  task: TaskRow;
  onSaved?: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(task.isRecurring ?? false);
  const [rule, setRule] = useState(task.recurrenceRule ?? 'FREQ=DAILY');
  const [anchorDate, setAnchorDate] = useState(
    (task.recurrenceAnchorDate ?? task.createdAt).toISOString().slice(0, 10)
  );
  const preferences = trpc.settings.getPreferences.useQuery(undefined, {
    enabled: task.recurrenceTz == null,
  });
  // Null means no local edit yet; an explicit empty string still clears the field.
  const [timezoneOverride, setTimezone] = useState<string | null>(task.recurrenceTz ?? null);
  const timezone = timezoneOverride ?? preferences.data?.timezone ?? '';
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateTaskMutation();
  useEffect(() => {
    onPendingChange?.(Boolean(update.isPending));
  }, [update.isPending, onPendingChange]);
  return (
    <Stack gap="xs">
      <Switch
        label="Recurring task"
        checked={enabled}
        disabled={update.isPending}
        onChange={(event) => setEnabled(event.currentTarget.checked)}
      />
      <TextInput
        label="Recurrence rule"
        value={rule}
        disabled={update.isPending}
        description="Examples: FREQ=DAILY;INTERVAL=2 or FREQ=WEEKLY;BYDAY=MO,WE,FR"
        onChange={(event) => setRule(event.currentTarget.value)}
      />
      <TextInput
        type="date"
        label="Recurrence anchor date"
        value={anchorDate}
        disabled={update.isPending}
        description="Start date for the recurrence cycle. Leave empty to use the task creation date."
        onChange={(event) => setAnchorDate(event.currentTarget.value)}
      />
      <TextInput
        label="Recurrence timezone"
        value={timezone}
        disabled={update.isPending}
        placeholder={preferences.isPending ? 'Loading default timezone…' : 'No timezone configured'}
        onChange={(event) => setTimezone(event.currentTarget.value)}
      />
      <Text size="xs" c="dimmed">
        Recurrence uses calendar dates anchored to the selected date, or the task creation date when
        unset. The timezone is stored as metadata; the current scheduler does not shift occurrences
        by timezone. Changes apply to newly generated occurrences; existing occurrences and plans
        are kept.
      </Text>
      {preferences.error && timezoneOverride === null && (
        <Alert color="red">
          Could not load your default timezone: {preferences.error.message}
          <Button variant="subtle" size="xs" onClick={() => void preferences.refetch()}>
            Retry timezone
          </Button>
        </Alert>
      )}
      {error && <Alert color="red">{error}</Alert>}
      {update.error && <Alert color="red">{update.error.message}</Alert>}
      <Button
        size="xs"
        variant="light"
        loading={update.isPending}
        disabled={timezoneOverride === null && !preferences.data}
        onClick={() => {
          const parsed = taskRecurrenceSchema.safeParse({
            isRecurring: enabled,
            recurrenceRule: rule.trim() || null,
            recurrenceAnchorDate: anchorDate || null,
            recurrenceTz: timezone.trim() || null,
          });
          if (!parsed.success) {
            setError(parsed.error.issues[0].message);
            return;
          }
          setError(null);
          update.mutate(
            { id: task.id, patch: { recurrence: parsed.data } },
            { onSuccess: () => onSaved?.() }
          );
        }}
      >
        Save recurrence
      </Button>
    </Stack>
  );
}
