'use client';

import { useState } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import type { TaskRow } from '@/lib/planner/tasks';
import { TaskRecurrence } from './TaskRecurrence';
import { formatRecurrence } from './format';

export function TaskRecurrenceProperty({ task }: { task: TaskRow }) {
  const [opened, setOpened] = useState(false);
  const [saving, setSaving] = useState(false);
  const summary = formatRecurrence(task);
  return (
    <>
      <Group gap="xs" wrap="nowrap" mih={28}>
        <Text size="sm" truncate title={summary} style={{ flex: 1, minWidth: 0 }}>
          {summary}
        </Text>
        <Button
          size="compact-xs"
          variant="subtle"
          onClick={() => setOpened(true)}
          aria-label="Edit recurrence"
        >
          Edit
        </Button>
      </Group>
      <Modal
        opened={opened}
        onClose={() => {
          if (!saving) {
            setOpened(false);
          }
        }}
        title="Recurrence settings"
        closeOnClickOutside={!saving}
        closeOnEscape={!saving}
        withCloseButton={!saving}
      >
        {opened && (
          <Stack>
            <TaskRecurrence
              key={task.id}
              task={task}
              onSaved={() => {
                setSaving(false);
                setOpened(false);
              }}
              onPendingChange={setSaving}
            />
            <Button variant="default" disabled={saving} onClick={() => setOpened(false)}>
              Cancel
            </Button>
          </Stack>
        )}
      </Modal>
    </>
  );
}
