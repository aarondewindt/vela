'use client';

import Link from 'next/link';
import { Alert, Box, Button, Group, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import { CalorieBalanceWidget } from './CalorieBalanceWidget';
import { MealDraftComposer } from '../Nutrition/MealDraftComposer';

export function DashboardCalorieBalance({ date }: { date: string }) {
  const utils = trpc.useUtils();
  const history = trpc.health.history.useQuery(
    { endDate: date, days: 7 },
    { retry: false, refetchInterval: 30000, refetchOnMount: 'always' }
  );
  const current = history.isFetchedAfterMount && !history.error ? history.data : undefined;
  // Never substitute an earlier day's burn when today's reading is missing.
  const selected = current?.days.find((day) => day.date === date);

  return (
    <Paper p="sm" w="100%">
      <Stack gap="xs" align="center">
        <Group justify="center" gap="xs">
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
          <Box w="100%" maw={560}>
            <CalorieBalanceWidget
              intake={selected?.intake ?? null}
              burned={selected?.burned ?? null}
              balance={selected?.balance ?? null}
              goal={current.goal}
            />
          </Box>
        )}
        <Group gap="md" justify="center">
          <Button component={Link} href="/health" variant="subtle" size="compact-xs">
            Open health dashboard
          </Button>
          <MealDraftComposer
            date={date}
            compact
            onConfirmed={async () => {
              await Promise.all([
                utils.nutrition.getDiary.invalidate(),
                utils.nutrition.getHistory.invalidate(),
                utils.nutrition.productSuggestions.invalidate(),
                utils.health.history.invalidate(),
              ]);
            }}
          />
        </Group>
      </Stack>
    </Paper>
  );
}
