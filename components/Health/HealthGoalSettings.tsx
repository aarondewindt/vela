'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Alert, Button, NumberInput, Paper, Stack, Text, Title } from '@mantine/core';
import { GoalOptionsFields } from '@/components/Goals/GoalOptionsFields';
import { defaultGoalOptions, type GoalOptions } from '@/lib/goals/semantics';
import { goalSchema } from '@/lib/health/schema';
import { trpc } from '@/lib/trpc/client';
export function HealthGoalForm({
  initial,
}: {
  initial: { calorieBalance: number | null; version: number; semantics?: GoalOptions };
}) {
  const utils = trpc.useUtils();
  const [options, setOptions] = useState(initial.semantics ?? defaultGoalOptions);
  const [error, setError] = useState<string | null>(null);
  const [goal, setGoal] = useState<number | string>(initial.calorieBalance ?? '');
  const save = trpc.health.saveGoal.useMutation({
    onSuccess: async () => {
      await utils.health.history.invalidate();
      await utils.health.getGoal.invalidate();
    },
  });
  return (
    <Paper withBorder p="md">
      <Stack>
        <Title order={3}>Daily calorie balance goal</Title>
        <Text size="sm">
          Balance = logged intake − total calories burned. Use a negative goal for a deficit, zero
          for maintenance, or a positive goal for a surplus. Your current goal is used for all dates
          shown.
        </Text>
        <NumberInput
          label="Goal (kcal per day)"
          description="For example, −300 for a deficit or +200 for a surplus. Leave empty for no goal."
          min={-10000}
          max={10000}
          decimalScale={0}
          value={goal}
          onChange={setGoal}
        />
        <GoalOptionsFields
          label="Calorie balance"
          value={options}
          onChange={setOptions}
          disabled={save.isPending}
        />
        <Text size="xs" c="dimmed">
          For a range, use the goal amount as its minimum, then set the maximum and optional
          preferred target. Bounds are inclusive.
        </Text>
        {error && <Alert color="red">{error}</Alert>}
        {save.error && <Alert color="red">{save.error.message}</Alert>}
        <Button
          loading={save.isPending}
          onClick={() => {
            const parsed = goalSchema.safeParse({
              calorieBalance: goal === '' ? null : Number(goal),
              version: initial.version,
              semantics: options,
            });
            if (!parsed.success) {
              setError(parsed.error.issues[0].message);
              return;
            }
            setError(null);
            save.mutate(parsed.data);
          }}
        >
          Save goal
        </Button>
      </Stack>
    </Paper>
  );
}

export function HealthGoalSettings() {
  const goal = trpc.health.getGoal.useQuery(undefined, { retry: false, refetchOnMount: 'always' });
  const current = goal.isFetchedAfterMount && !goal.error ? goal.data : undefined;
  return (
    <Stack gap="lg">
      <Title order={3}>Health</Title>
      {!current && !goal.error && <Text role="status">Loading goal…</Text>}
      {goal.error && (
        <Alert color="red">
          {goal.error.message}
          <Button variant="subtle" onClick={() => void goal.refetch()}>
            Retry loading goal
          </Button>
        </Alert>
      )}
      {current && <HealthGoalForm key={current.version} initial={current} />}
      <Button component={Link} href="/settings/home-assistant" variant="default">
        Configure Home Assistant and health sensors
      </Button>
      <Button component={Link} href="/health" variant="subtle">
        Back to Health
      </Button>
    </Stack>
  );
}
