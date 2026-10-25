'use client';

import Link from 'next/link';
import { Alert, Anchor, Loader, Paper, Stack } from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import { HealthMetricSummary } from './HealthMetricSummary';

export function DashboardHealthSummaries({ date }: { date: string }) {
  // Same key as the dashboard gauge: TanStack Query shares the request and cache.
  const history = trpc.health.history.useQuery(
    { endDate: date, days: 7 },
    { retry: false, refetchInterval: 30000, refetchOnMount: 'always' }
  );
  const data = history.isFetchedAfterMount && !history.error ? history.data : undefined;
  const selected = data?.days.find((day) => day.date === date);
  const sleep = data?.days.findLast((day) => day.metrics.SLEEP != null)?.metrics.SLEEP ?? null;
  return (
    <Paper withBorder p="sm" w="100%" maw="34rem">
      <Stack gap="xs">
        {history.error && (
          <Alert color="red">Could not load Health summaries: {history.error.message}</Alert>
        )}
        {!data && !history.error && <Loader aria-label="Loading health summaries" />}
        {data && (
          <Stack gap="xs">
            <HealthMetricSummary
              label="Weight"
              unit="kg"
              date={date}
              record={selected?.metrics.WEIGHT ?? null}
              goal={data.goal.metricGoals.WEIGHT}
            />
            <HealthMetricSummary
              label="Body fat"
              unit="%"
              date={date}
              record={selected?.metrics.BODY_FAT ?? null}
              goal={data.goal.metricGoals.BODY_FAT}
            />
            <HealthMetricSummary
              label="Sleep"
              unit="hours"
              date={date}
              record={sleep}
              goal={data.goal.metricGoals.SLEEP}
            />
          </Stack>
        )}
        <Anchor component={Link} href="/health" size="xs">
          View Health history
        </Anchor>
      </Stack>
    </Paper>
  );
}
