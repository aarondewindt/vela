'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Button,
  Container,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import { goalsInputSchema, type GoalsInput } from '@/lib/nutrition/diary-schema';
import { GoalOptionsFields } from '@/components/Goals/GoalOptionsFields';
import { goalKeys } from '@/lib/nutrition/types';

function GoalsForm({
  initial,
  onSaved,
  onReload,
}: {
  initial: GoalsInput;
  onSaved: () => Promise<void>;
  onReload: () => void;
}) {
  const [value, setValue] = useState<GoalsInput>({
    ...initial,
    semantics: { protein: { kind: 'minimum' }, fiber: { kind: 'minimum' }, ...initial.semantics },
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = trpc.nutrition.saveGoals.useMutation({ retry: false });
  const labels = {
    calories: 'Calories (kcal)',
    protein: 'Protein (g)',
    carbohydrates: 'Carbohydrates (g)',
    fat: 'Fat (g)',
    fiber: 'Fiber (g)',
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (save.isPending) {
      return;
    }
    const parsed = goalsInputSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setError(null);
    setSaved(false);
    try {
      const result = await save.mutateAsync(parsed.data);
      setValue(result);
    } catch {
      return;
    }
    await onSaved();
    setSaved(true);
  };
  return (
    <form onSubmit={(event) => void submit(event)}>
      <Stack>
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          {goalKeys.map((key) => (
            <Stack key={key} gap="xs">
              <TextInput
                label={labels[key]}
                description={
                  value.semantics?.[key]?.kind === 'range' ||
                  value.semantics?.[key]?.kind === 'minimum'
                    ? 'Minimum amount'
                    : undefined
                }
                inputMode="decimal"
                placeholder="No goal"
                disabled={save.isPending}
                value={value[key] ?? ''}
                onChange={(event) => {
                  setSaved(false);
                  setValue({ ...value, [key]: event.currentTarget.value || null });
                }}
              />
              <GoalOptionsFields
                label={labels[key]}
                value={value.semantics?.[key]}
                disabled={save.isPending}
                onChange={(options) => {
                  setSaved(false);
                  setValue({ ...value, semantics: { ...value.semantics, [key]: options } });
                }}
              />
            </Stack>
          ))}
        </SimpleGrid>
        {error && <Alert color="red">{error}</Alert>}
        {save.error && (
          <Alert color="red" title="Could not save goals">
            <Text>{save.error.message}</Text>
            <Button variant="light" onClick={onReload}>
              Reload goals
            </Button>
          </Alert>
        )}
        {saved && <Alert color="teal">Daily goals saved.</Alert>}
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            Save daily goals
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function NutritionGoalsView({ returnDate }: { returnDate?: string }) {
  const utils = trpc.useUtils();
  const goals = trpc.nutrition.getGoals.useQuery(undefined, {
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  const [reload, setReload] = useState(0);
  const current = goals.isFetchedAfterMount && !goals.error ? goals.data : undefined;
  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={2}>Daily nutrition goals</Title>
          <Button
            component={Link}
            href={returnDate ? `/nutrition?date=${returnDate}` : '/nutrition'}
            variant="default"
          >
            Back to diary
          </Button>
        </Group>
        <Text c="dimmed">
          Enter your own daily targets. Leave any goal empty to track that nutrient without a
          target. For minimum and range goals, the first amount is the minimum; configure a
          preferred target and maximum or excellent threshold below. Your current goals apply to
          every diary day.
        </Text>
        {!current && !goals.error && (
          <Group role="status">
            <Loader size="sm" />
            <Text>Loading goals…</Text>
          </Group>
        )}
        {goals.error && (
          <Alert color="red">
            <Text>{goals.error.message}</Text>
            <Button variant="light" onClick={() => void goals.refetch()}>
              Retry loading goals
            </Button>
          </Alert>
        )}
        {current && (
          <GoalsForm
            key={reload}
            initial={current}
            onReload={() => {
              void goals.refetch().then(() => setReload((value) => value + 1));
            }}
            onSaved={async () => {
              await utils.nutrition.getGoals.invalidate();
              await utils.nutrition.getDiary.invalidate();
            }}
          />
        )}
      </Stack>
    </Container>
  );
}
