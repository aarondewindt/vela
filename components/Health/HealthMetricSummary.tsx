import { Paper, Stack, Text, Title } from '@mantine/core';
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
    <Paper withBorder p="sm" miw={0}>
      <Stack gap="xs">
        <Title order={2} size="h5">
          {label}
        </Title>
        <Text size="xl" fw={650}>
          {record
            ? `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(record.value)} ${unit}`
            : 'Not recorded'}
        </Text>
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
    </Paper>
  );
}
