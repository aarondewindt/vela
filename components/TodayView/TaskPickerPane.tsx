'use client';

import { useMemo, useState } from 'react';
import { Badge, Group, ScrollArea, Stack, Text, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { sortTasksByPlanningPriority } from '@/lib/planner/scheduling';
import type { TaskRow, ThemeRow } from '@/lib/planner/tasks';
import { TaskCard } from '../TasksView/TaskCard';
import classes from './TodayView.module.css';

export const TASK_DRAG_TYPE = 'application/x-vela-task';

type Props = {
  tasks: TaskRow[];
  themes: ThemeRow[];
  date: string;
  removeActive: boolean;
  onTaskDragStart: (task: TaskRow) => void;
  onTaskDragEnd: () => void;
  onRemoveDrop: () => void;
  onOpenTask: (task: TaskRow) => void;
};

export function TaskPickerPane({
  tasks,
  themes,
  date,
  removeActive,
  onTaskDragStart,
  onTaskDragEnd,
  onRemoveDrop,
  onOpenTask,
}: Props) {
  const [search, setSearch] = useState('');
  const [dropHover, setDropHover] = useState(false);

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? tasks.filter(
          (task) =>
            task.title.toLowerCase().includes(query) || task.brief?.toLowerCase().includes(query)
        )
      : tasks;
    return sortTasksByPlanningPriority(filtered, new Date(`${date}T00:00:00.000Z`));
  }, [tasks, search, date]);
  const themesById = useMemo(() => new Map(themes.map((theme) => [theme.id, theme])), [themes]);

  return (
    <div
      className={classes.taskPane}
      data-drop-active={removeActive || undefined}
      data-drop-hover={(removeActive && dropHover) || undefined}
      onDragOver={(event) => {
        if (!removeActive) return;
        event.preventDefault();
        setDropHover(true);
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={(event) => {
        if (!removeActive) return;
        event.preventDefault();
        setDropHover(false);
        onRemoveDrop();
      }}
    >
      <Stack gap="xs" p="xs" className={classes.taskPaneHeader}>
        <Group justify="space-between">
          <Text fw={600} size="sm">
            Tasks
          </Text>
          <Badge variant="light" color="gray">
            {visibleTasks.length}
          </Badge>
        </Group>
        <TextInput
          size="xs"
          placeholder="Search tasks"
          aria-label="Search tasks"
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        {removeActive && (
          <Text size="xs" c="dimmed">
            Drop here to remove from the plan
          </Text>
        )}
      </Stack>
      <ScrollArea className={classes.taskPaneList} p="xs">
        <Stack gap="xs" p="xs">
          {visibleTasks.length === 0 ? (
            <Text size="sm" c="dimmed">
              No tasks available to add.
            </Text>
          ) : (
            visibleTasks.map((task) => (
              <div
                key={task.id}
                draggable
                className={classes.taskPaneItem}
                onDragStart={(event) => {
                  event.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
                  event.dataTransfer.effectAllowed = 'copy';
                  onTaskDragStart(task);
                }}
                onDragEnd={onTaskDragEnd}
              >
                <TaskCard
                  compact
                  task={task}
                  theme={task.themeId ? themesById.get(task.themeId) : null}
                  onOpen={() => onOpenTask(task)}
                />
              </div>
            ))
          )}
        </Stack>
      </ScrollArea>
    </div>
  );
}
