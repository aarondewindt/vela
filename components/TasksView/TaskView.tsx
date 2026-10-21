'use client';

import { useDeleteTaskMutation, useUpdateTaskMutation } from '@/lib/planner/query';
import {
  priorityOptions,
  taskStatuses,
  taskStatusLabels,
  taskSizeOptions,
  planningCategories,
  planningCategoryLabels,
  type TaskRow,
  type ThemeRow,
} from '@/lib/planner/tasks';
import { useState, type ReactNode } from 'react';
import { ActionIcon, Alert, Button, Group, Menu, Modal, Stack, Text } from '@mantine/core';
import { IconDots, IconTrash } from '@tabler/icons-react';
import { PropertyPanel, ReadOnlyValue, Property, TitleField } from '../DataView/PropertyPanel';
import {
  DateProperty,
  NumberProperty,
  SelectProperty,
  TagsProperty,
  TextProperty,
} from '../DataView/properties';
import { formatDate, formatDateTime } from './format';
import { TaskRecurrence } from './TaskRecurrence';
import { TaskReview } from './TaskReview';
import { TaskContentEditor } from './TaskContentEditor';

type Props = {
  task: TaskRow;
  themes: ThemeRow[];
  tagSuggestions: string[];
  onClose: () => void;
  actions?: ReactNode;
};

export function TaskView({ task, themes, tagSuggestions, onClose, actions }: Props) {
  const [deleteTarget, setDeleteTarget] = useState<TaskRow | null>(null);
  const update = useUpdateTaskMutation();
  const remove = useDeleteTaskMutation();
  const themeCategory = themes.find((theme) => theme.id === task.themeId)?.category;
  const save = (patch: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate({ id: task.id, patch });

  return (
    <>
      <Modal
        opened={deleteTarget !== null}
        onClose={() => {
          if (!remove.isPending) {
            setDeleteTarget(null);
          }
        }}
        title="Delete task?"
        closeOnClickOutside={!remove.isPending}
        closeOnEscape={!remove.isPending}
        withCloseButton={!remove.isPending}
      >
        <Stack>
          <Text>
            Delete “{deleteTarget?.title}” permanently? This deletes the task and its occurrences.
            Existing day blocks remain, but lose their task link. This cannot be undone.
          </Text>
          {remove.error && (
            <Alert color="red" role="alert">
              {remove.error.message}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button
              variant="default"
              data-autofocus
              disabled={remove.isPending}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              color="red"
              loading={remove.isPending}
              onClick={() => {
                if (!deleteTarget || remove.isPending) {
                  return;
                }
                const targetId = deleteTarget.id;
                remove.mutate(
                  { id: targetId },
                  {
                    onSuccess: () => {
                      setDeleteTarget(null);
                      if (task.id === targetId) {
                        onClose();
                      }
                    },
                  }
                );
              }}
            >
              Delete task
            </Button>
          </Group>
        </Stack>
      </Modal>
      <PropertyPanel
        kind="Task"
        id={task.id}
        onClose={onClose}
        actions={
          <>
            {actions}
            <Menu withinPortal position="bottom-end">
              <Menu.Target>
                <ActionIcon
                  aria-label="Task actions"
                  variant="subtle"
                  color="gray"
                  disabled={remove.isPending}
                >
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={16} />}
                  onClick={() => {
                    remove.reset();
                    setDeleteTarget(task);
                  }}
                >
                  Delete task…
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </>
        }
        content={
          <>
            <TaskContentEditor taskId={task.id} />
            <TaskReview key={task.id} taskId={task.id} themes={themes} />
          </>
        }
      >
        {update.error && <Alert color="red">{update.error.message}</Alert>}
        <TitleField value={task.title} onSave={(title) => save({ title })} />

        <SelectProperty
          label="Status"
          value={task.status}
          data={taskStatuses.map((value) => ({ value, label: taskStatusLabels[value] }))}
          onSave={(status) => save({ status: status as TaskRow['status'] })}
        />
        <SelectProperty
          label="Priority"
          value={String(task.priority)}
          data={priorityOptions}
          onSave={(priority) => save({ priority: Number(priority) })}
        />
        <SelectProperty
          label="Size"
          value={String(task.size)}
          data={taskSizeOptions}
          onSave={(size) => save({ size: Number(size) })}
        />
        <SelectProperty
          label="Theme"
          value={task.themeId ?? ''}
          data={[
            { value: '', label: 'No theme' },
            ...themes.map((theme) => ({ value: theme.id, label: theme.name })),
          ]}
          onSave={(themeId) => save({ themeId: themeId || null })}
        />
        <SelectProperty
          label="Category"
          value={task.category ?? ''}
          data={[
            {
              value: '',
              label: themeCategory
                ? `Use theme default (${planningCategoryLabels[themeCategory]})`
                : 'Use theme default',
            },
            ...planningCategories.map((value) => ({ value, label: planningCategoryLabels[value] })),
          ]}
          onSave={(category) =>
            save({ category: category ? (category as TaskRow['category']) : null })
          }
        />
        <DateProperty
          label="Due date"
          value={task.dueDate}
          onSave={(dueDate) => save({ dueDate })}
        />
        <Property label="Recurrence">
          <TaskRecurrence key={`${task.id}:${task.updatedAt.toISOString()}`} task={task} />
        </Property>
        <NumberProperty
          label="Lead time"
          suffix=" days"
          value={task.leadTimeDays}
          onSave={(leadTimeDays) => save({ leadTimeDays })}
        />
        <Property label="Scheduled">
          <ReadOnlyValue>{formatDate(task.scheduledDate)}</ReadOnlyValue>
        </Property>
        <NumberProperty
          label="Estimate"
          suffix=" min"
          value={task.estimatedMinutes}
          onSave={(estimatedMinutes) => save({ estimatedMinutes })}
        />
        <TagsProperty
          label="Tags"
          value={task.tags}
          suggestions={tagSuggestions}
          onSave={(tags) => save({ tags })}
        />
        <TextProperty label="Brief" value={task.brief} onSave={(brief) => save({ brief })} />
        <Property label="Created">
          <ReadOnlyValue>{formatDateTime(task.createdAt)}</ReadOnlyValue>
        </Property>
        <Property label="Updated">
          <ReadOnlyValue>{formatDateTime(task.updatedAt)}</ReadOnlyValue>
        </Property>
      </PropertyPanel>
    </>
  );
}
