'use client';

import { useState } from 'react';
import { Alert, Button, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useUpdateTaskMutation } from '@/lib/planner/query';
import { taskRecurrenceSchema } from '@/lib/planner/record-schema';
import type { TaskRow } from '@/lib/planner/tasks';

export function TaskRecurrence({ task }: { task: TaskRow }) {
  const [enabled, setEnabled] = useState(task.isRecurring ?? false);
  const [rule, setRule] = useState(task.recurrenceRule ?? 'FREQ=DAILY');
  const [timezone, setTimezone] = useState(task.recurrenceTz ?? '');
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateTaskMutation();
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
        label="Recurrence timezone"
        value={timezone}
        disabled={update.isPending}
        placeholder="No timezone configured"
        onChange={(event) => setTimezone(event.currentTarget.value)}
      />
      <Text size="xs" c="dimmed">
        Recurrence uses calendar dates anchored to the task creation date. The timezone is stored as
        metadata; the current scheduler does not shift occurrences by timezone. Changes apply to
        newly generated occurrences; existing occurrences and plans are kept.
      </Text>
      {error && <Alert color="red">{error}</Alert>}
      {update.error && <Alert color="red">{update.error.message}</Alert>}
      <Button
        size="xs"
        variant="light"
        loading={update.isPending}
        onClick={() => {
          const parsed = taskRecurrenceSchema.safeParse({
            isRecurring: enabled,
            recurrenceRule: rule.trim() || null,
            recurrenceTz: timezone.trim() || null,
          });
          if (!parsed.success) {
            setError(parsed.error.issues[0].message);
            return;
          }
          setError(null);
          update.mutate({ id: task.id, patch: { recurrence: parsed.data } });
        }}
      >
        Save recurrence
      </Button>
    </Stack>
  );
}
