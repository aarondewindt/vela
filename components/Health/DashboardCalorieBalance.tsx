'use client';

import Link from 'next/link';
import { Alert, Anchor, Button, Group, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import { CalorieBalanceWidget } from './CalorieBalanceWidget';

export function DashboardCalorieBalance({ date }: { date: string }) {
  const history = trpc.health.history.useQuery(
    { endDate: date, days: 7 },
    { retry: false, refetchInterval: 30000, refetchOnMount: 'always' }
  );
  const current = history.isFetchedAfterMount && !history.error ? history.data : undefined;
  // Never substitute an earlier day's burn when today's reading is missing.
  const selected = current?.days.find((day) => day.date === date);

  return (
    <Paper withBorder p="sm" w="100%" maw="34rem">
      <Stack gap="xs">
        <Group justify="space-between" gap="xs">
          <Title order={2} size="h5">
            Today's calorie balance
          </Title>
          <Text size="xs" c="dimmed">
            {date}
          </Text>
        </Group>
        {!current && !history.error && <Loader aria-label="Loading today's calorie balance" />}
        {history.error && (
          <Alert color="red">
            {history.error.message}
            <Button variant="subtle" onClick={() => void history.refetch()}>
              Retry calorie balance
            </Button>
          </Alert>
        )}
        {current && (
          <CalorieBalanceWidget
            intake={selected?.intake ?? null}
            burned={selected?.burned ?? null}
            balance={selected?.balance ?? null}
            goal={current.goal}
          />
        )}
        <Group gap="md">
          <Anchor component={Link} href="/health" size="xs">
            Open health dashboard
          </Anchor>
          <Anchor component={Link} href="/settings/health" size="xs">
            Edit health goals
          </Anchor>
        </Group>
      </Stack>
    </Paper>
  );
}
