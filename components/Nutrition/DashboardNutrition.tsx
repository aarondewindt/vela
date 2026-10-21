'use client';

import Link from 'next/link';
import { Alert, Anchor, Button, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import { DailyNutritionSummary } from './DailyNutritionSummary';

export function DashboardNutrition({ date }: { date: string }) {
  const diary = trpc.nutrition.getDiary.useQuery(
    { date },
    { retry: false, refetchInterval: 30000, refetchOnMount: 'always' }
  );
  const current = diary.isFetchedAfterMount && !diary.error ? diary.data : undefined;
  return (
    <Paper withBorder p="md">
      <Stack>
        <Title order={2}>Today's nutrition</Title>
        <Text c="dimmed">{date} · Recorded intake so far; your diary may be incomplete.</Text>
        {!current && !diary.error && <Loader aria-label="Loading today's nutrition" />}
        {diary.error && (
          <Alert color="red">
            {diary.error.message}
            <Button variant="subtle" onClick={() => void diary.refetch()}>
              Retry nutrition
            </Button>
          </Alert>
        )}
        {current && <DailyNutritionSummary day={current} />}
        <Anchor component={Link} href={`/nutrition?date=${date}`}>
          Open nutrition diary
        </Anchor>
        <Anchor component={Link} href="/settings/nutrition">
          Edit nutrition goals
        </Anchor>
      </Stack>
    </Paper>
  );
}
