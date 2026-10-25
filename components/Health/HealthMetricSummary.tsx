'use client';

import { ActionIcon, Group, Popover, Stack, Text, Title } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { describeGoal, type GoalOptions } from '@/lib/goals/semantics';

export function HealthMetricSummary({
  label,
  unit,
  record,
  goal,
  date,
}: {
  label: string;
  unit: string;
  date: string;
  record: { value: number; measurementDate: string; source: string } | null;
  goal?: { target: number | null; semantics: GoalOptions };
}) {
  return (
    <Group justify="label" gap="xs" wrap="nowrap">
      <Title order={2} size="sm">
        {label}
      </Title>
      <Group gap={4} wrap="nowrap">
        <Text size="sm" fw={650}>
          {record
            ? `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(record.value)} ${unit}`
            : 'Not recorded'}
        </Text>
        <Popover position="bottom-end" width={260} shadow="sm" withArrow>
          <Popover.Target>
            <ActionIcon variant="subtle" color="gray.9" size="sm" aria-label={`${label} details`}>
              <IconInfoCircle size={14} aria-hidden="true" />
            </ActionIcon>
          </Popover.Target>
          <Popover.Dropdown>
            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                {record
                  ? `${record.measurementDate}${record.measurementDate !== date ? ' · Latest known reading' : ''} · ${record.source === 'samsung_health' ? 'Samsung Health' : record.source === 'manual' ? 'Manual reading' : 'Home Assistant'}`
                  : label === 'Sleep'
                    ? 'No sleep recorded in the last 7 days'
                    : 'No reading available'}
              </Text>
              {goal?.target != null && (
                <Text size="xs" c="dimmed">
                  Goal: {describeGoal(String(goal.target), goal.semantics)} {unit}
                </Text>
              )}
            </Stack>
          </Popover.Dropdown>
        </Popover>
      </Group>
    </Group>
  );
}
