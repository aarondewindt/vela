'use client';

import { useState } from 'react';
import { Paper, ScrollArea, Stack, Text } from '@mantine/core';
import { planningCategories, planningCategoryLabels, type PlanningCategoryValue } from '@/lib/planner/tasks';
import classes from './TodayView.module.css';

export const CATEGORY_DRAG_TYPE = 'application/x-vela-category';

type Props = {
  colors: Record<string, string>;
  removeActive: boolean;
  onCategoryDragStart: (category: PlanningCategoryValue) => void;
  onCategoryDragEnd: () => void;
  onRemoveDrop: () => void;
};

export function CategoryPickerPane({
  colors,
  removeActive,
  onCategoryDragStart,
  onCategoryDragEnd,
  onRemoveDrop,
}: Props) {
  const [dropHover, setDropHover] = useState(false);

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
        <Text fw={600} size="sm">
          Categories
        </Text>
        <Text size="xs" c="dimmed">
          {removeActive ? 'Drop here to remove the slot' : 'Drag onto the schedule to add a slot'}
        </Text>
      </Stack>
      <ScrollArea className={classes.taskPaneList}>
        <Stack gap="xs" p="xs">
          {planningCategories.map((category) => (
            <div
              key={category}
              draggable
              className={classes.taskPaneItem}
              onDragStart={(event) => {
                event.dataTransfer.setData(CATEGORY_DRAG_TYPE, category);
                event.dataTransfer.effectAllowed = 'copy';
                onCategoryDragStart(category);
              }}
              onDragEnd={onCategoryDragEnd}
            >
              <Paper
                withBorder
                px="xs"
                py={6}
                radius="sm"
                style={{
                  borderInlineStart: `4px solid var(--mantine-color-${colors[category] ?? 'gray'}-6)`,
                }}
              >
                <Text size="sm" fw={600}>
                  {planningCategoryLabels[category]}
                </Text>
              </Paper>
            </div>
          ))}
        </Stack>
      </ScrollArea>
    </div>
  );
}
