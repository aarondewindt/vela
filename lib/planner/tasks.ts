import type { PropertyDef, ViewConfig } from '@/lib/views/types';

export const TASKS_SCOPE = 'tasks';

export const taskStatuses = ['BACKLOG', 'PAUSED', 'IN_PROGRESS', 'DONE', 'ARCHIVED'] as const;
export type TaskStatusValue = (typeof taskStatuses)[number];

export const taskStatusLabels: Record<TaskStatusValue, string> = {
  BACKLOG: 'Backlog',
  PAUSED: 'Paused',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  ARCHIVED: 'Archived',
};

export const taskStatusColors: Record<TaskStatusValue, string> = {
  BACKLOG: 'gray',
  PAUSED: 'yellow',
  IN_PROGRESS: 'blue',
  DONE: 'green',
  ARCHIVED: 'dark',
};

export const taskSizeValues = [0, 1, 2, 3, 4, 5] as const;
export type TaskSize = (typeof taskSizeValues)[number];

export const taskSizeLabels: Record<TaskSize, string> = {
  0: 'Unknown',
  1: 'XS',
  2: 'S',
  3: 'M',
  4: 'L',
  5: 'XL',
};

export const taskSizeOptions = taskSizeValues.map((size) => ({
  value: String(size),
  label: taskSizeLabels[size],
}));

export function taskSizeLabel(size: number): string {
  return taskSizeLabels[size as TaskSize] ?? taskSizeLabels[0];
}

export type TaskRow = {
  id: string;
  title: string;
  brief: string | null;
  status: TaskStatusValue;
  priority: number;
  size: number;
  dueDate: Date | null;
  // Derived from the next open occurrence; not stored on the task.
  scheduledDate: Date | null;
  estimatedMinutes: number | null;
  themeId: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type ThemeRow = {
  id: string;
  name: string;
  brief: string | null;
  color: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export const priorityOptions = [1, 2, 3, 4, 5].map((p) => ({ value: String(p), label: `P${p}` }));

export function getTaskProperties(themes: ThemeRow[], tags: string[]): PropertyDef<TaskRow>[] {
  return [
    { key: 'title', label: 'Title', type: 'text', get: (t) => t.title },
    { key: 'brief', label: 'Brief', type: 'text', get: (t) => t.brief },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      get: (t) => t.status,
      options: taskStatuses.map((value) => ({
        value,
        label: taskStatusLabels[value],
        color: taskStatusColors[value],
      })),
    },
    {
      key: 'priority',
      label: 'Priority',
      type: 'select',
      get: (t) => String(t.priority),
      options: priorityOptions,
    },
    {
      key: 'size',
      label: 'Size',
      type: 'select',
      get: (t) => String(t.size),
      options: taskSizeOptions,
    },
    { key: 'dueDate', label: 'Due date', type: 'date', get: (t) => t.dueDate },
    { key: 'scheduledDate', label: 'Scheduled', type: 'date', get: (t) => t.scheduledDate },
    { key: 'estimatedMinutes', label: 'Estimate', type: 'number', get: (t) => t.estimatedMinutes },
    {
      key: 'theme',
      label: 'Theme',
      type: 'select',
      get: (t) => t.themeId,
      options: [...themes]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((theme) => ({ value: theme.id, label: theme.name, color: theme.color })),
    },
    {
      key: 'tags',
      label: 'Tags',
      type: 'multiSelect',
      get: (t) => t.tags,
      options: tags.map((tag) => ({ value: tag, label: tag })),
    },
    { key: 'createdAt', label: 'Created', type: 'date', get: (t) => t.createdAt },
    { key: 'updatedAt', label: 'Updated', type: 'date', get: (t) => t.updatedAt },
  ];
}

const defaultVisible = [
  'brief',
  'status',
  'priority',
  'size',
  'dueDate',
  'scheduledDate',
  'estimatedMinutes',
  'tags',
];

const defaultSorts: ViewConfig['sorts'] = [
  { property: 'dueDate', direction: 'asc' },
  { property: 'priority', direction: 'asc' },
  { property: 'createdAt', direction: 'asc' },
];

const base: ViewConfig = {
  layout: 'table',
  groupBy: 'theme',
  filters: [],
  sorts: defaultSorts,
  visibleProperties: defaultVisible,
};

const notDone = (id: string) => ({
  id,
  property: 'status',
  operator: 'isNot' as const,
  value: 'DONE',
});
const notArchived = (id: string) => ({
  id,
  property: 'status',
  operator: 'isNot' as const,
  value: 'ARCHIVED',
});

export const builtInTaskViews: { id: string; name: string; config: ViewConfig }[] = [
  {
    id: 'builtin:all',
    name: 'All Tasks',
    config: { ...base, filters: [notArchived('a1')] },
  },
  {
    id: 'builtin:today',
    name: 'Today',
    config: {
      ...base,
      filters: [
        notDone('t1'),
        notArchived('t2'),
        { id: 't3', property: 'scheduledDate', operator: 'onOrBefore', value: '@today' },
      ],
    },
  },
  {
    id: 'builtin:upcoming',
    name: 'Upcoming',
    config: {
      ...base,
      groupBy: null,
      filters: [
        notDone('u1'),
        notArchived('u2'),
        { id: 'u3', property: 'dueDate', operator: 'onOrAfter', value: '@today' },
        { id: 'u4', property: 'dueDate', operator: 'onOrBefore', value: '@today+14' },
      ],
    },
  },
  {
    id: 'builtin:backlog',
    name: 'Backlog',
    config: {
      ...base,
      filters: [{ id: 'b1', property: 'status', operator: 'is', value: 'BACKLOG' }],
    },
  },
  {
    id: 'builtin:completed',
    name: 'Completed',
    config: {
      ...base,
      groupBy: null,
      filters: [{ id: 'c1', property: 'status', operator: 'is', value: 'DONE' }],
      sorts: [{ property: 'updatedAt', direction: 'desc' }],
    },
  },
];
