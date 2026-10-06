'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Center,
  Group,
  Loader,
  Popover,
  Portal,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconDeviceFloppy, IconPlus, IconRestore, IconTrash } from '@tabler/icons-react';
import {
  useCreateTaskMutation,
  useCreateThemeMutation,
  useCreateViewMutation,
  useDeleteViewMutation,
  useReorderThemesMutation,
  useTasksQuery,
  useThemesQuery,
  useUpdateViewMutation,
  useViewsQuery,
} from '@/lib/planner/query';
import {
  builtInTaskViews,
  getTaskProperties,
  TASKS_SCOPE,
  type TaskRow,
} from '@/lib/planner/tasks';
import { groupRows, runView } from '@/lib/views/engine';
import type { SavedViewRecord, ViewConfig } from '@/lib/views/types';
import { useAppShellStore } from '@/store/app_shell_store';
import { useTasksViewStore } from '@/store/tasks_view_store';
import { ViewToolbar } from '../DataView/ViewToolbar';
import { TaskGroup } from './TaskGroup';
import { TaskView } from './TaskView';
import { ThemeInspector } from './ThemeInspector';

const searchFields = (task: TaskRow) => [task.title, task.brief ?? '', ...task.tags];

function NameForm({
  label,
  placeholder,
  onSubmit,
  loading,
}: {
  label: string;
  placeholder: string;
  onSubmit: (name: string) => void;
  loading?: boolean;
}) {
  const [name, setName] = useState('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) {
          onSubmit(name.trim());
          setName('');
        }
      }}
    >
      <Group gap="xs" wrap="nowrap">
        <TextInput
          aria-label={label}
          placeholder={placeholder}
          size="xs"
          data-autofocus
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <Button type="submit" size="xs" loading={loading}>
          Add
        </Button>
      </Group>
    </form>
  );
}

export const TasksView = () => {
  const tasksQuery = useTasksQuery();
  const themesQuery = useThemesQuery();
  const viewsQuery = useViewsQuery(TASKS_SCOPE);
  const createTask = useCreateTaskMutation();
  const createTheme = useCreateThemeMutation();
  const reorderThemes = useReorderThemesMutation();
  const createView = useCreateViewMutation();
  const updateView = useUpdateViewMutation();
  const deleteView = useDeleteViewMutation();

  const { activeViewId, draft, search, selection, collapsed } = useTasksViewStore();
  const { setActiveView, setDraft, setSearch, select, toggleCollapsed } = useTasksViewStore();
  const setAsideOpened = useAppShellStore((state) => state.set_aside_opened);

  useEffect(() => () => setAsideOpened(false), [setAsideOpened]);

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const themes = useMemo(() => themesQuery.data ?? [], [themesQuery.data]);

  const allTags = useMemo(() => [...new Set(tasks.flatMap((t) => t.tags))].sort(), [tasks]);
  const defs = useMemo(() => getTaskProperties(themes, allTags), [themes, allTags]);

  const views: SavedViewRecord[] = useMemo(
    () => [
      ...builtInTaskViews.map((v) => ({ ...v, scope: TASKS_SCOPE, builtIn: true })),
      ...(viewsQuery.data ?? []),
    ],
    [viewsQuery.data]
  );
  const activeView = views.find((v) => v.id === activeViewId) ?? views[0];
  const config: ViewConfig = draft ?? activeView.config;

  const today = new Date().toLocaleDateString('en-CA');
  const visibleTasks = useMemo(
    () => runView(tasks, config, defs, { search, searchFields, today }),
    [tasks, config, defs, search, today]
  );

  const groupDef = config.groupBy ? defs.find((d) => d.key === config.groupBy) : undefined;
  const isFiltered = config.filters.length > 0 || search.trim() !== '';
  const groups = useMemo(() => {
    if (!groupDef) {
      return null;
    }
    const all = groupRows(visibleTasks, groupDef, `No ${groupDef.label.toLowerCase()}`);
    const showEmpty = groupDef.key === 'theme' && !isFiltered;
    return all.filter((g) => g.rows.length > 0 || (showEmpty && g.key !== null));
  }, [groupDef, visibleTasks, isFiltered]);

  const selectedTask = selection?.type === 'task' ? tasks.find((t) => t.id === selection.id) : null;
  const selectedTheme =
    selection?.type === 'theme' ? themes.find((t) => t.id === selection.id) : null;
  const inspectorOpen = Boolean(selectedTask || selectedTheme);
  useEffect(() => setAsideOpened(inspectorOpen), [inspectorOpen, setAsideOpened]);

  const moveTheme = (themeId: string, direction: -1 | 1) => {
    const shown = (groups ?? []).flatMap((g) => (g.key ? [g.key] : []));
    const neighbor = shown[shown.indexOf(themeId) + direction];
    if (!neighbor) {
      return;
    }
    const ids = themes.map((t) => t.id);
    const a = ids.indexOf(themeId);
    const b = ids.indexOf(neighbor);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    reorderThemes.mutate({ orderedIds: ids });
  };

  const isCustomView = !activeView.builtIn;
  const saveAs = (name: string) =>
    createView.mutate(
      { scope: TASKS_SCOPE, name, config },
      {
        onSuccess: (view) => {
          setActiveView(view.id);
        },
      }
    );

  const error = tasksQuery.error ?? themesQuery.error ?? viewsQuery.error;
  const loading = tasksQuery.isPending || themesQuery.isPending;

  const inspector = selectedTask ? (
    <TaskView
      task={selectedTask}
      themes={themes}
      tagSuggestions={allTags}
      onClose={() => select(null)}
    />
  ) : selectedTheme ? (
    <ThemeInspector
      theme={selectedTheme}
      tasks={tasks.filter((t) => t.themeId === selectedTheme.id)}
      onClose={() => select(null)}
    />
  ) : null;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Tasks</Title>
          <Text c="dimmed" size="sm">
            {visibleTasks.length} of {tasks.length} tasks
          </Text>
        </div>
        <Group gap="xs">
          <Popover position="bottom-end" shadow="md" trapFocus>
            <Popover.Target>
              <Button size="xs" variant="default" leftSection={<IconPlus size={14} />}>
                New theme
              </Button>
            </Popover.Target>
            <Popover.Dropdown>
              <NameForm
                label="Theme name"
                placeholder="Theme name"
                loading={createTheme.isPending}
                onSubmit={(name) => createTheme.mutate({ name })}
              />
            </Popover.Dropdown>
          </Popover>
          <Popover position="bottom-end" shadow="md" trapFocus>
            <Popover.Target>
              <Button size="xs" leftSection={<IconPlus size={14} />}>
                New task
              </Button>
            </Popover.Target>
            <Popover.Dropdown>
              <NameForm
                label="Task title"
                placeholder="Task title"
                loading={createTask.isPending}
                onSubmit={(title) => createTask.mutate({ title })}
              />
            </Popover.Dropdown>
          </Popover>
        </Group>
      </Group>

      <Tabs value={activeView.id} onChange={(id) => id && setActiveView(id)}>
        <Tabs.List>
          {views.map((view) => (
            <Tabs.Tab key={view.id} value={view.id}>
              {view.name}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      <Group justify="space-between" align="flex-start">
        <ViewToolbar
          defs={defs}
          config={config}
          onChange={setDraft}
          search={search}
          onSearchChange={setSearch}
        />
        <Group gap="xs">
          {draft && (
            <>
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                leftSection={<IconRestore size={14} />}
                onClick={() => setDraft(null)}
              >
                Reset
              </Button>
              {isCustomView && (
                <Button
                  size="xs"
                  leftSection={<IconDeviceFloppy size={14} />}
                  loading={updateView.isPending}
                  onClick={() =>
                    updateView.mutate(
                      { id: activeView.id, patch: { config: draft } },
                      { onSuccess: () => setDraft(null) }
                    )
                  }
                >
                  Save
                </Button>
              )}
            </>
          )}
          <Popover position="bottom-end" shadow="md" trapFocus>
            <Popover.Target>
              <Button size="xs" variant="default">
                Save as new view
              </Button>
            </Popover.Target>
            <Popover.Dropdown>
              <NameForm
                label="View name"
                placeholder="View name"
                loading={createView.isPending}
                onSubmit={saveAs}
              />
            </Popover.Dropdown>
          </Popover>
          {isCustomView && (
            <ActionIcon
              aria-label="Delete view"
              variant="subtle"
              color="red"
              loading={deleteView.isPending}
              onClick={() =>
                deleteView.mutate({ id: activeView.id }, { onSuccess: () => setActiveView('builtin:all') })
              }
            >
              <IconTrash size={16} />
            </ActionIcon>
          )}
        </Group>
      </Group>

      {error && (
        <Alert color="red" title="Could not load tasks">
          {error.message}
        </Alert>
      )}
      {createTask.error && (
        <Alert color="red" title="Could not add task">
          {createTask.error.message}
        </Alert>
      )}

      {loading ? (
        <Center py="xl">
          <Loader size="sm" />
        </Center>
      ) : groups ? (
        <Stack gap="md">
          {groups.length === 0 && (
            <Text c="dimmed" ta="center" py="lg">
              No tasks match this view.
            </Text>
          )}
          {groups.map((group, index) => {
            const theme = groupDef?.key === 'theme' && group.key ? themes.find((t) => t.id === group.key) : null;
            const key = `${config.groupBy}:${group.key ?? 'none'}`;
            return (
              <TaskGroup
                key={key}
                group={group}
                theme={theme ?? null}
                canAdd={groupDef?.key === 'theme'}
                expanded={!collapsed[key]}
                visibleProperties={config.visibleProperties}
                defs={defs}
                themes={themes}
                selectedTaskId={selectedTask?.id ?? null}
                isFirst={index === 0 || groups[index - 1].key === null}
                isLast={index === groups.length - 1 || groups[index + 1].key === null}
                onToggle={() => toggleCollapsed(key)}
                onAdd={(title) => createTask.mutate({ title, themeId: group.key })}
                onSelectTask={(id) => select({ type: 'task', id })}
                onSelectTheme={(id) => select({ type: 'theme', id })}
                onMove={(direction) => group.key && moveTheme(group.key, direction)}
              />
            );
          })}
        </Stack>
      ) : (
        <TaskGroup
          group={{ key: null, label: 'All tasks', rows: visibleTasks }}
          theme={null}
          canAdd={false}
          expanded
          visibleProperties={config.visibleProperties}
          defs={defs}
          themes={themes}
          selectedTaskId={selectedTask?.id ?? null}
          isFirst
          isLast
          onToggle={() => {}}
          onAdd={() => {}}
          onSelectTask={(id) => select({ type: 'task', id })}
          onSelectTheme={() => {}}
          onMove={() => {}}
        />
      )}

      {inspector && <Portal target="#app-aside">{inspector}</Portal>}
    </Stack>
  );
};
