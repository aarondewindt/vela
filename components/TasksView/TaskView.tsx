'use client';

import type { ReactNode } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Divider,
  Group,
  NumberInput,
  ScrollArea,
  Select,
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

const ROW_HEIGHT = 28;

// Shared look for property values: default fill, no border or padding, one line tall.
// Right padding stays so text doesn't run under the select chevron.
const inputStyle = {
  border: 'none',
  background: 'transparent',
  paddingInlineStart: 0,
  paddingBlock: 0,
} as const;

const field = {
  size: 'sm',
  styles: { input: { ...inputStyle, height: ROW_HEIGHT, minHeight: ROW_HEIGHT } },
} as const;

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Text size="sm" c="dimmed" w={96} h={ROW_HEIGHT} lh={`${ROW_HEIGHT}px`} style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Group>
  );
}

function ReadOnlyValue({ children }: { children: ReactNode }) {
  return (
    <Text size="sm" h={ROW_HEIGHT} lh={`${ROW_HEIGHT}px`}>
      {children}
    </Text>
  );
}

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
        <Stack gap={2} key={task.id}>
          <Textarea
            aria-label="Title"
            variant="unstyled"
            autosize
            minRows={1}
            mb="xs"
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

          <Property label="Status">
            <Select
              {...field}
              aria-label="Status"
              allowDeselect={false}
              value={task.status}
              data={taskStatuses.map((value) => ({ value, label: taskStatusLabels[value] }))}
              onChange={(value) => value && save({ status: value as TaskRow['status'] })}
            />
          </Property>
          <Property label="Priority">
            <Select
              {...field}
              aria-label="Priority"
              allowDeselect={false}
              value={String(task.priority)}
              data={priorityOptions}
              onChange={(value) => value && save({ priority: Number(value) })}
            />
          </Property>
          <Property label="Theme">
            <Select
              {...field}
              aria-label="Theme"
              allowDeselect={false}
              value={task.themeId ?? ''}
              data={[
                { value: '', label: 'No theme' },
                ...themes.map((theme) => ({ value: theme.id, label: theme.name })),
              ]}
              onChange={(value) => value !== null && save({ themeId: value || null })}
            />
          </Property>
          <Property label="Due date">
            <TextInput
              {...field}
              aria-label="Due date"
              type="date"
              defaultValue={toDateInput(task.dueDate)}
              onChange={(event) => save({ dueDate: event.currentTarget.value || null })}
            />
          </Property>
          <Property label="Scheduled">
            <ReadOnlyValue>{formatDate(task.scheduledDate)}</ReadOnlyValue>
          </Property>
          <Property label="Estimate">
            <NumberInput
              {...field}
              aria-label="Estimate in minutes"
              placeholder="Empty"
              suffix=" min"
              min={0}
              allowDecimal={false}
              hideControls
              defaultValue={task.estimatedMinutes ?? ''}
              onBlur={(event) => {
                const raw = event.currentTarget.value.replace(/\D/g, '');
                const next = raw === '' ? null : Number(raw);
                if (next !== task.estimatedMinutes) {
                  save({ estimatedMinutes: next });
                }
              }}
            />
          </Property>
          <Property label="Tags">
            <TagsInput
              size="sm"
              aria-label="Tags"
              placeholder="Empty"
              styles={{ input: { ...inputStyle, minHeight: ROW_HEIGHT } }}
              data={tagSuggestions}
              value={task.tags}
              onChange={(tags) => save({ tags })}
            />
          </Property>
          <Property label="Brief">
            <Textarea
              size="sm"
              aria-label="Brief"
              placeholder="Empty"
              autosize
              minRows={1}
              styles={{ input: { ...inputStyle, minHeight: ROW_HEIGHT } }}
              defaultValue={task.brief ?? ''}
              onBlur={(event) => {
                const brief = event.currentTarget.value.trim() || null;
                if (brief !== task.brief) {
                  save({ brief });
                }
              }}
            />
          </Property>
          <Property label="Created">
            <ReadOnlyValue>{formatDateTime(task.createdAt)}</ReadOnlyValue>
          </Property>
          <Property label="Updated">
            <ReadOnlyValue>{formatDateTime(task.updatedAt)}</ReadOnlyValue>
          </Property>

          <Divider my="sm" />

          <TaskContentEditor taskId={task.id} />

          <Button
            mt="md"
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
