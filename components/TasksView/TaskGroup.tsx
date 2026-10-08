'use client';

import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Collapse,
  ColorSwatch,
  Group,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { DataTable, useDataTableColumns, type DataTableColumn } from 'mantine-datatable';
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconPlus,
} from '@tabler/icons-react';
import {
  taskStatusColors,
  taskStatusLabels,
  taskSizeLabel,
  type TaskRow,
  type ThemeRow,
} from '@/lib/planner/tasks';
import { getPaletteColorCssValue } from '@/lib/color-palette';
import type { ViewGroup } from '@/lib/views/engine';
import type { PropertyDef } from '@/lib/views/types';
import { formatDate, formatDateTime } from './format';

type Props = {
  group: ViewGroup<TaskRow>;
  // Set when grouped by theme; enables the theme-specific header actions.
  theme: ThemeRow | null;
  canAdd: boolean;
  expanded: boolean;
  visibleProperties: string[];
  defs: PropertyDef<TaskRow>[];
  themes: ThemeRow[];
  selectedTaskId: string | null;
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onAdd: (title: string) => void;
  onSelectTask: (id: string) => void;
  onSelectTheme: (id: string) => void;
  onMove: (direction: -1 | 1) => void;
};

const COLUMNS_KEY = 'tasks-table-columns';

const columnWidths: Record<string, number> = {
  status: 120,
  priority: 90,
  size: 80,
  dueDate: 130,
  scheduledDate: 130,
  estimatedMinutes: 100,
  theme: 150,
  tags: 200,
  createdAt: 170,
  updatedAt: 170,
};

function buildColumns(
  visible: string[],
  defs: PropertyDef<TaskRow>[],
  themes: ThemeRow[]
): DataTableColumn<TaskRow>[] {
  const render: Record<string, DataTableColumn<TaskRow>['render']> = {
    brief: (t) => (
      <Text size="sm" c="dimmed" truncate>
        {t.brief ?? ''}
      </Text>
    ),
    status: (t) => (
      <Badge variant="light" color={taskStatusColors[t.status]}>
        {taskStatusLabels[t.status]}
      </Badge>
    ),
    priority: (t) => `P${t.priority}`,
    size: (t) => taskSizeLabel(t.size),
    dueDate: (t) => formatDate(t.dueDate),
    scheduledDate: (t) => formatDate(t.scheduledDate),
    estimatedMinutes: (t) => (t.estimatedMinutes ? `${t.estimatedMinutes} min` : '—'),
    theme: (t) => themes.find((theme) => theme.id === t.themeId)?.name ?? '—',
    tags: (t) =>
      t.tags.length ? (
        <Group gap={4}>
          {t.tags.map((tag) => (
            <Badge key={tag} size="sm" variant="outline" color="gray">
              {tag}
            </Badge>
          ))}
        </Group>
      ) : (
        '—'
      ),
    createdAt: (t) => formatDateTime(t.createdAt),
    updatedAt: (t) => formatDateTime(t.updatedAt),
  };

  const title: DataTableColumn<TaskRow> = {
    accessor: 'title',
    title: 'Task',
    width: 260,
    resizable: true,
    render: (t) => (
      <Text fw={500} size="sm">
        {t.title}
      </Text>
    ),
  };

  const rest = visible.flatMap((key) => {
    const def = defs.find((d) => d.key === key);
    if (!def || !render[key]) {
      return [];
    }
    // Brief takes the remaining width; max-width 0 lets the cell shrink and truncate.
    const flexible =
      key === 'brief' ? { width: '100%', cellsStyle: () => ({ maxWidth: 0 }) } : { width: columnWidths[key] };
    return [
      {
        accessor: key,
        title: def.label,
        render: render[key],
        resizable: true,
        ...flexible,
      } as DataTableColumn<TaskRow>,
    ];
  });

  return [title, ...rest];
}

export function TaskGroup({
  group,
  theme,
  canAdd,
  expanded,
  visibleProperties,
  defs,
  themes,
  selectedTaskId,
  isFirst,
  isLast,
  onToggle,
  onAdd,
  onSelectTask,
  onSelectTheme,
  onMove,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');

  const columns = useMemo(
    () => buildColumns(visibleProperties, defs, themes),
    [visibleProperties, defs, themes]
  );
  // All group tables share one key, so widths stay aligned across groups.
  const { effectiveColumns } = useDataTableColumns<TaskRow>({ key: COLUMNS_KEY, columns });

  const open = group.rows.filter((t) => t.status !== 'DONE' && t.status !== 'ARCHIVED');
  const minutes = open.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);
  const nextDue = open
    .map((t) => t.dueDate)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  const submit = () => {
    const value = title.trim();
    if (value) {
      onAdd(value);
    }
    setTitle('');
    setAdding(false);
  };

  return (
    <Box>
      <Group justify="space-between" py={6} wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <ActionIcon
            aria-label={expanded ? 'Collapse group' : 'Expand group'}
            variant="subtle"
            color="gray"
            size="sm"
            onClick={onToggle}
          >
            {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          </ActionIcon>
          {group.color && (
            <ColorSwatch color={getPaletteColorCssValue(group.color, 'accent')} size={12} />
          )}
          {theme ? (
            <UnstyledButton onClick={() => onSelectTheme(theme.id)}>
              <Text fw={600} td="underline" style={{ textDecorationStyle: 'dotted' }}>
                {group.label}
              </Text>
            </UnstyledButton>
          ) : (
            <Text fw={600}>{group.label}</Text>
          )}
          <Text size="xs" c="dimmed">
            {open.length} open · {group.rows.length} total
            {minutes > 0 && ` · ${minutes} min`}
            {nextDue && ` · next due ${formatDate(nextDue)}`}
          </Text>
        </Group>

        <Group gap={2} wrap="nowrap">
          {theme && (
            <>
              <ActionIcon
                aria-label="Move theme up"
                variant="subtle"
                color="gray"
                size="sm"
                disabled={isFirst}
                onClick={() => onMove(-1)}
              >
                <IconArrowUp size={14} />
              </ActionIcon>
              <ActionIcon
                aria-label="Move theme down"
                variant="subtle"
                color="gray"
                size="sm"
                disabled={isLast}
                onClick={() => onMove(1)}
              >
                <IconArrowDown size={14} />
              </ActionIcon>
            </>
          )}
          {canAdd && (
            <ActionIcon
              aria-label={`Add task to ${group.label}`}
              variant="subtle"
              size="sm"
              onClick={() => setAdding(true)}
            >
              <IconPlus size={16} />
            </ActionIcon>
          )}
        </Group>
      </Group>

      <Collapse expanded={expanded}>
        {adding && (
          <TextInput
            aria-label={`New task in ${group.label}`}
            placeholder="Task title, then press Enter"
            size="xs"
            mb="xs"
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                submit();
              } else if (event.key === 'Escape') {
                setTitle('');
                setAdding(false);
              }
            }}
            onBlur={submit}
          />
        )}
        {group.rows.length ? (
          <DataTable
            withTableBorder
            highlightOnHover
            idAccessor="id"
            minHeight={0}
            records={group.rows}
            columns={effectiveColumns}
            storeColumnsKey={COLUMNS_KEY}
            onRowClick={({ record }) => onSelectTask(record.id)}
            rowStyle={(record) =>
              record.id === selectedTaskId
                ? { backgroundColor: 'var(--mantine-color-blue-light)', cursor: 'pointer' }
                : { cursor: 'pointer' }
            }
          />
        ) : (
          <Text size="sm" c="dimmed" pl="xl" pb="xs">
            No tasks
          </Text>
        )}
      </Collapse>
    </Box>
  );
}
