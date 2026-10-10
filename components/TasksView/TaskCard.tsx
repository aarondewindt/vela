'use client';

import { ActionIcon, Badge, Group, Paper, Text, Tooltip } from '@mantine/core';
import { IconLayoutSidebarRight } from '@tabler/icons-react';
import {
  planningCategoryLabels,
  taskSizeLabel,
  taskStatusColors,
  taskStatusLabels,
  type TaskRow,
  type ThemeRow,
} from '@/lib/planner/tasks';
import { getPaletteColorCssValue } from '@/lib/color-palette';
import { formatDate } from './format';

type Props = {
  task: TaskRow;
  theme?: ThemeRow | null;
  compact?: boolean;
  onOpen?: () => void;
};

export function TaskCard({ task, theme = null, compact = false, onOpen }: Props) {
  const accentColor = theme?.color
    ? getPaletteColorCssValue(theme.color, 'accent')
    : 'var(--mantine-color-default-border)';
  const category = task.category ?? theme?.category ?? null;
  const openButton = onOpen && (
    <Tooltip label="Open details">
      <ActionIcon
        aria-label={`Open ${task.title}`}
        variant="subtle"
        color="gray"
        size="sm"
        onClick={onOpen}
      >
        <IconLayoutSidebarRight size={14} />
      </ActionIcon>
    </Tooltip>
  );

  if (compact) {
    return (
      <Paper
        withBorder
        px="xs"
        py={6}
        radius="sm"
        style={{ borderInlineStart: `4px solid ${accentColor}` }}
      >
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text size="sm" fw={600} lineClamp={1}>
            {task.title}
          </Text>
          {openButton}
        </Group>
        <Group gap="xs" wrap="wrap">
          <Text size="xs">P{task.priority}</Text>
          <Text size="xs">{taskSizeLabel(task.size)}</Text>
          {category && <Text size="xs">{planningCategoryLabels[category]}</Text>}
          {task.estimatedMinutes ? <Text size="xs">{task.estimatedMinutes} min</Text> : null}
          {task.dueDate && (
            <Text size="xs" c="dimmed">
              Due {formatDate(task.dueDate)}
            </Text>
          )}
        </Group>
      </Paper>
    );
  }

  return (
    <Paper withBorder p="sm" radius="sm" style={{ borderInlineStart: `4px solid ${accentColor}` }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Text fw={600}>{task.title}</Text>
          {task.brief && (
            <Text size="sm" c="dimmed" mt={2}>
              {task.brief}
            </Text>
          )}
        </div>
        <Group gap="xs" wrap="nowrap">
          {openButton}
          <Badge variant="light" color={taskStatusColors[task.status]}>
            {taskStatusLabels[task.status]}
          </Badge>
        </Group>
      </Group>

      <Group gap="md" mt="sm" wrap="wrap">
        <Text size="sm">Priority P{task.priority}</Text>
        <Text size="sm">Size {taskSizeLabel(task.size)}</Text>
        {category && <Text size="sm">{planningCategoryLabels[category]}</Text>}
        {task.estimatedMinutes ? <Text size="sm">{task.estimatedMinutes} min</Text> : null}
        <Text size="sm" c="dimmed">
          Due {formatDate(task.dueDate)}
        </Text>
        <Text size="sm" c="dimmed">
          {theme?.name ?? 'No theme'}
        </Text>
      </Group>
    </Paper>
  );
}
