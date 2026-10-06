'use client';

import { useDeleteTaskMutation, useUpdateTaskMutation } from '@/lib/planner/query';
import {
  priorityOptions,
  taskStatuses,
  taskStatusLabels,
  type TaskRow,
  type ThemeRow,
} from '@/lib/planner/tasks';
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
};

export function TaskView({ task, themes, tagSuggestions, onClose }: Props) {
  const update = useUpdateTaskMutation();
  const remove = useDeleteTaskMutation();
  const save = (patch: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate({ id: task.id, patch });

  return (
    <PropertyPanel
      kind="Task"
      id={task.id}
      onClose={onClose}
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
        label="Theme"
        value={task.themeId ?? ''}
        data={[
          { value: '', label: 'No theme' },
          ...themes.map((theme) => ({ value: theme.id, label: theme.name })),
        ]}
        onSave={(themeId) => save({ themeId: themeId || null })}
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
