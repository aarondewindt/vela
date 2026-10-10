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
import type { ReactNode } from 'react';
import { Button } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { PropertyPanel, ReadOnlyValue, Property, TitleField } from '../DataView/PropertyPanel';
import {
  DateProperty,
  NumberProperty,
  SelectProperty,
  TagsProperty,
  TextProperty,
} from '../DataView/properties';
import { formatDate, formatDateTime } from './format';
import { TaskContentEditor } from './TaskContentEditor';

type Props = {
  task: TaskRow;
  themes: ThemeRow[];
  tagSuggestions: string[];
  onClose: () => void;
  actions?: ReactNode;
};

export function TaskView({ task, themes, tagSuggestions, onClose, actions }: Props) {
  const update = useUpdateTaskMutation();
  const remove = useDeleteTaskMutation();
  const save = (patch: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate({ id: task.id, patch });

  return (
    <PropertyPanel
      kind="Task"
      id={task.id}
      onClose={onClose}
      actions={actions}
      content={
        <>
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
        </>
      }
    >
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
          { value: '', label: 'Use theme default' },
          ...planningCategories.map((value) => ({ value, label: planningCategoryLabels[value] })),
        ]}
        onSave={(category) =>
          save({ category: category ? (category as TaskRow['category']) : null })
        }
      />
      <DateProperty label="Due date" value={task.dueDate} onSave={(dueDate) => save({ dueDate })} />
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
  );
}
