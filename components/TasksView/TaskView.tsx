'use client';

import {
  ActionIcon,
  Button,
  Group,
  NativeSelect,
  NumberInput,
  ScrollArea,
  Stack,
  TagsInput,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { IconTrash, IconX } from '@tabler/icons-react';
import { useDeleteTaskMutation, useUpdateTaskMutation } from '@/lib/planner/query';
import {
  priorityOptions,
  taskStatuses,
  taskStatusLabels,
  type TaskRow,
  type ThemeRow,
} from '@/lib/planner/tasks';
import { formatDate, formatDateTime, toDateInput } from './format';
import { TaskContentEditor } from './TaskContentEditor';

type Props = {
  task: TaskRow;
  themes: ThemeRow[];
  tagSuggestions: string[];
  onClose: () => void;
};

export function TaskView({ task, themes, tagSuggestions, onClose }: Props) {
  const update = useUpdateTaskMutation();
  const remove = useDeleteTaskMutation();
  const save = (patch: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate({ id: task.id, patch });

  return (
    <Stack h="100%" gap={0}>
      <Group justify="space-between" p="md" wrap="nowrap">
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          Task
        </Text>
        <ActionIcon aria-label="Close inspector" variant="subtle" color="gray" onClick={onClose}>
          <IconX size={16} />
        </ActionIcon>
      </Group>

      <ScrollArea style={{ flex: 1 }} px="md" pb="md">
        <Stack gap="sm" key={task.id}>
          <Textarea
            aria-label="Title"
            variant="unstyled"
            autosize
            minRows={1}
            styles={{ input: { fontSize: 'var(--mantine-h3-font-size)', fontWeight: 700 } }}
            defaultValue={task.title}
            onBlur={(event) => {
              const title = event.currentTarget.value.trim();
              if (title && title !== task.title) {
                save({ title });
              } else {
                event.currentTarget.value = task.title;
              }
            }}
          />

          <NativeSelect
            label="Status"
            value={task.status}
            data={taskStatuses.map((value) => ({ value, label: taskStatusLabels[value] }))}
            onChange={(event) => save({ status: event.currentTarget.value as TaskRow['status'] })}
          />
          <NativeSelect
            label="Priority"
            value={String(task.priority)}
            data={priorityOptions}
            onChange={(event) => save({ priority: Number(event.currentTarget.value) })}
          />
          <NativeSelect
            label="Theme"
            value={task.themeId ?? ''}
            data={[
              { value: '', label: 'No theme' },
              ...themes.map((theme) => ({ value: theme.id, label: theme.name })),
            ]}
            onChange={(event) => save({ themeId: event.currentTarget.value || null })}
          />
          <TextInput
            label="Due date"
            type="date"
            defaultValue={toDateInput(task.dueDate)}
            onChange={(event) => save({ dueDate: event.currentTarget.value || null })}
          />
          <TextInput
            label="Scheduled"
            description="From the next open occurrence"
            readOnly
            value={formatDate(task.scheduledDate)}
          />
          <NumberInput
            label="Estimate (minutes)"
            min={0}
            allowDecimal={false}
            defaultValue={task.estimatedMinutes ?? ''}
            onBlur={(event) => {
              const raw = event.currentTarget.value.trim();
              const next = raw === '' ? null : Number(raw);
              if (next !== task.estimatedMinutes) {
                save({ estimatedMinutes: next });
              }
            }}
          />
          <TagsInput
            label="Tags"
            data={tagSuggestions}
            value={task.tags}
            onChange={(tags) => save({ tags })}
          />
          <Textarea
            label="Brief"
            autosize
            minRows={3}
            defaultValue={task.brief ?? ''}
            onBlur={(event) => {
              const brief = event.currentTarget.value.trim() || null;
              if (brief !== task.brief) {
                save({ brief });
              }
            }}
          />

          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Created {formatDateTime(task.createdAt)}
            </Text>
            <Text size="xs" c="dimmed">
              Updated {formatDateTime(task.updatedAt)}
            </Text>
          </Stack>

          <TaskContentEditor taskId={task.id} />

          <Button
            color="red"
            variant="light"
            leftSection={<IconTrash size={16} />}
            loading={remove.isPending}
            onClick={() => remove.mutate({ id: task.id }, { onSuccess: onClose })}
          >
            Delete task
          </Button>
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
