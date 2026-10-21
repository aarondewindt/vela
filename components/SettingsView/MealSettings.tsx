'use client';
import { useState } from 'react';
import {
  Alert,
  Button,
  Group,
  NumberInput,
  Paper,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import {
  mealKinds,
  mealTitles,
  mealPreferencesSchema,
  type MealPreferences,
  type MealKind,
} from '@/lib/planner/meals';

const time = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const minute = (value: string) =>
  /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(value)
    ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
    : NaN;
function MealForm({
  initial,
  version,
  onReload,
}: {
  initial: MealPreferences;
  version: number;
  onReload: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [times, setTimes] = useState(
    () =>
      Object.fromEntries(
        mealKinds.map((kind) => [
          kind,
          { start: time(initial[kind].startMinute), end: time(initial[kind].endMinute) },
        ])
      ) as Record<MealKind, { start: string; end: string }>
  );
  const [savedVersion, setSavedVersion] = useState(version);
  const [saved, setSaved] = useState(false);
  const utils = trpc.useUtils();
  const save = trpc.planner.saveMealPreferences.useMutation({
    onSuccess: async (result) => {
      setSavedVersion(result.version);
      setSaved(true);
      await utils.planner.getMealPreferences.invalidate();
    },
  });
  const patch = (
    kind: (typeof mealKinds)[number],
    value: Partial<MealPreferences[typeof kind]>
  ) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [kind]: { ...current[kind], ...value } }));
  };
  const validation = mealPreferencesSchema.safeParse(
    Object.fromEntries(
      mealKinds.map((kind) => [
        kind,
        {
          ...draft[kind],
          startMinute: minute(times[kind].start),
          endMinute: minute(times[kind].end),
        },
      ])
    )
  );
  const updateTime = (kind: MealKind, field: 'start' | 'end', value: string) => {
    setSaved(false);
    setTimes((current) => ({ ...current, [kind]: { ...current[kind], [field]: value } }));
  };
  return (
    <Stack>
      {mealKinds.map((kind) => (
        <Paper key={kind} withBorder p="sm">
          <Stack gap="xs">
            <Switch
              label={`Schedule ${mealTitles[kind].toLowerCase()}`}
              checked={draft[kind].enabled}
              disabled={save.isPending}
              onChange={(event) => patch(kind, { enabled: event.currentTarget.checked })}
            />
            <Group grow>
              <TextInput
                label={`${mealTitles[kind]} window start`}
                placeholder="HH:mm"
                value={times[kind].start}
                disabled={save.isPending}
                onChange={(event) => updateTime(kind, 'start', event.currentTarget.value)}
              />
              <TextInput
                label={`${mealTitles[kind]} window end`}
                placeholder="HH:mm"
                value={times[kind].end}
                disabled={save.isPending}
                onChange={(event) => updateTime(kind, 'end', event.currentTarget.value)}
              />
              <NumberInput
                label={`${mealTitles[kind]} duration`}
                suffix=" min"
                min={5}
                max={240}
                allowDecimal={false}
                disabled={save.isPending}
                value={
                  Number.isFinite(draft[kind].durationMinutes) ? draft[kind].durationMinutes : ''
                }
                onChange={(value) =>
                  patch(kind, { durationMinutes: typeof value === 'number' ? value : NaN })
                }
              />
            </Group>
          </Stack>
        </Paper>
      ))}
      {!validation.success && (
        <Alert color="yellow">
          Each meal needs a valid window large enough for its full duration.
        </Alert>
      )}
      {save.error && (
        <Alert color="red">
          {save.error.message}
          <Button variant="subtle" onClick={onReload}>
            Reload saved meals
          </Button>
        </Alert>
      )}
      {saved && <Text role="status">Meal preferences saved.</Text>}
      <Button
        disabled={!validation.success || save.isPending}
        loading={save.isPending}
        onClick={() => {
          if (validation.success) {
            save.mutate({ preferences: validation.data, version: savedVersion });
          }
        }}
      >
        Save meal preferences
      </Button>
    </Stack>
  );
}
export function MealSettings() {
  const query = trpc.planner.getMealPreferences.useQuery();
  const [reload, setReload] = useState(0);
  return (
    <Stack>
      <Title order={4}>Daily meals</Title>
      <Text c="dimmed">
        Reserve one continuous block for preparation, eating and cleanup. Enable each meal and
        choose its preferred window. Generate or replan a day to include meals; saved blocks keep
        individual edits.
      </Text>
      {query.isPending && <Text role="status">Loading meal preferences…</Text>}
      {query.error && (
        <Alert color="red">
          {query.error.message}
          <Button variant="subtle" onClick={() => void query.refetch()}>
            Reload meal preferences
          </Button>
        </Alert>
      )}
      {query.data && !query.error && (
        <MealForm
          key={reload}
          initial={query.data.preferences}
          version={query.data.version}
          onReload={() => {
            void query.refetch().then((result) => {
              if (result.data && !result.error) {
                setReload((current) => current + 1);
              }
            });
          }}
        />
      )}
    </Stack>
  );
}
