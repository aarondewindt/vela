'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Group, ScrollArea, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { trpc } from '@/lib/trpc/client';
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
  const [semantic, setSemantic] = useState(true);
  const [debouncedSearch] = useDebouncedValue(search.trim(), 350);
  const retrieval = trpc.taskSearch.retrieve.useQuery(
    { query: debouncedSearch, date, semantic, limit: 50 },
    { enabled: Boolean(debouncedSearch), retry: false, staleTime: 0 }
  );
  const sourceVersion = tasks.map((task) => `${task.id}:${task.updatedAt.getTime()}`).join(',');
  const previousSource = useRef(sourceVersion);
  useEffect(() => {
    if (previousSource.current !== sourceVersion) {
      previousSource.current = sourceVersion;
      if (debouncedSearch) {
        void retrieval.refetch();
      }
    }
  }, [sourceVersion, debouncedSearch, retrieval.refetch]);
  const [dropHover, setDropHover] = useState(false);

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (
      query &&
      debouncedSearch === search.trim() &&
      retrieval.data &&
      !retrieval.isError &&
      !retrieval.isFetching
    ) {
      const byId = new Map(tasks.map((task) => [task.id, task]));
      return retrieval.data.ids.flatMap((id) => {
        const task = byId.get(id);
        return task ? [task] : [];
      });
    }
    const filtered = query
      ? tasks.filter((task) =>
          [task.title, task.brief, ...task.tags]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(query)
        )
      : tasks;
    return sortTasksByPlanningPriority(filtered, new Date(`${date}T00:00:00.000Z`));
  }, [
    tasks,
    search,
    date,
    debouncedSearch,
    retrieval.data,
    retrieval.isError,
    retrieval.isFetching,
  ]);
  const themesById = useMemo(() => new Map(themes.map((theme) => [theme.id, theme])), [themes]);

  return (
    <div
      className={classes.taskPane}
      data-drop-active={removeActive || undefined}
      data-drop-hover={(removeActive && dropHover) || undefined}
      onDragOver={(event) => {
        if (!removeActive) {
          return;
        }
        event.preventDefault();
        setDropHover(true);
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={(event) => {
        if (!removeActive) {
          return;
        }
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
        <Switch
          size="xs"
          label="Search by meaning too"
          checked={semantic}
          onChange={(event) => setSemantic(event.currentTarget.checked)}
        />
        {search.trim() && (retrieval.isFetching || debouncedSearch !== search.trim()) && (
          <Text size="xs" c="dimmed" role="status">
            Searching tasks…
          </Text>
        )}
        {search.trim() && retrieval.isError && (
          <Stack gap={4}>
            <Text size="xs" role="alert">
              Search failed. Showing current text matches.
            </Text>
            <Button size="compact-xs" variant="subtle" onClick={() => void retrieval.refetch()}>
              Retry search
            </Button>
          </Stack>
        )}
        {search.trim() &&
          debouncedSearch === search.trim() &&
          retrieval.data?.warnings.map((warning) => (
            <Text key={warning} size="xs" c="dimmed" role="status">
              {warning}
            </Text>
          ))}
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
              {search.trim() ? 'No matching eligible tasks.' : 'No tasks available to add.'}
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
