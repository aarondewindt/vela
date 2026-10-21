'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Anchor,
  Button,
  Container,
  Group,
  Loader,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { LineChart } from '@mantine/charts';
import { GoalOptionsFields } from '@/components/Goals/GoalOptionsFields';
import {
  defaultGoalOptions,
  describeGoal,
  goalStatusLabels,
  type GoalOptions,
} from '@/lib/goals/semantics';
import { trpc } from '@/lib/trpc/client';
import {
  goalSchema,
  metricKinds,
  metricLabels,
  metricUnits,
  type MetricKind,
} from '@/lib/health/schema';
import { historyInputSchema } from '@/lib/nutrition/reuse-schema';
import { dateInTimezone } from '@/lib/nutrition/dates';

const amount = (value: number | null | undefined, unit = '') =>
  value == null
    ? 'Not recorded'
    : `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value)}${unit ? ` ${unit}` : ''}`;
function GoalForm({
  initial,
}: {
  initial: { calorieBalance: number | null; version: number; semantics?: GoalOptions };
}) {
  const utils = trpc.useUtils();
  const [options, setOptions] = useState(initial.semantics ?? defaultGoalOptions);
  const [error, setError] = useState<string | null>(null);
  const [goal, setGoal] = useState<number | string>(initial.calorieBalance ?? '');
  const save = trpc.health.saveGoal.useMutation({
    onSuccess: () => utils.health.history.invalidate(),
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
function ManualEntry({ date }: { date: string }) {
  const utils = trpc.useUtils();
  const [metric, setMetric] = useState<MetricKind>('WEIGHT');
  const [value, setValue] = useState<number | string>('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const save = trpc.health.log.useMutation({
    onSuccess: async () => {
      setValue('');
      setRequestId(crypto.randomUUID());
      await utils.health.history.invalidate();
    },
  });
  return (
    <Paper withBorder p="md">
      <Stack>
        <Title order={3}>Add a manual reading</Title>
        <Text size="sm">
          Recorded for {date}. A daily total replaces the displayed total; it is never added to
          other totals.
        </Text>
        <Group align="flex-end">
          <Select
            label="Metric"
            data={metricKinds.map((x) => ({ value: x, label: metricLabels[x] }))}
            value={metric}
            onChange={(v) => {
              if (v) {
                setMetric(v as MetricKind);
                setValue('');
                setRequestId(crypto.randomUUID());
              }
            }}
          />
          <NumberInput
            label={`Value (${metricUnits[metric]})`}
            min={0}
            value={value}
            onChange={(v) => {
              setValue(v);
              setRequestId(crypto.randomUUID());
            }}
          />
          <Button
            disabled={value === ''}
            loading={save.isPending}
            onClick={() => save.mutate({ metric, date, value: Number(value), requestId })}
          >
            Add reading
          </Button>
        </Group>
        {save.error && <Alert color="red">{save.error.message}</Alert>}
        {save.isSuccess && <Text>Reading saved.</Text>}
      </Stack>
    </Paper>
  );
}
export function HealthView({ initialDate, timezone }: { initialDate: string; timezone: string }) {
  const [date, setDate] = useState(initialDate);
  const [days, setDays] = useState<7 | 30>(7);
  const valid = historyInputSchema.safeParse({ endDate: date, days }).success;
  const history = trpc.health.history.useQuery(
    { endDate: date, days },
    { enabled: valid, refetchInterval: 30000 }
  );
  const connection = trpc.homeAssistant.get.useQuery(undefined, { refetchInterval: 30000 });
  const utils = trpc.useUtils();
  const remove = trpc.health.remove.useMutation({
    onSuccess: () => utils.health.history.invalidate(),
  });
  const data = valid && !history.error ? history.data : undefined;
  const selected = data?.days.at(-1);
  const chart =
    data?.days.map((day) => ({
      date: day.date.slice(5),
      weight: day.metrics.WEIGHT?.carriedForward ? null : (day.metrics.WEIGHT?.value ?? null),
      lean: day.metrics.LEAN_MASS?.carriedForward ? null : (day.metrics.LEAN_MASS?.value ?? null),
      fat: day.metrics.BODY_FAT?.carriedForward ? null : (day.metrics.BODY_FAT?.value ?? null),
      sleep: day.metrics.SLEEP?.value ?? null,
      balance: day.balance,
      goal:
        data.goal.semantics?.kind === 'range'
          ? data.goal.semantics.preferredTarget === undefined
            ? null
            : Number(data.goal.semantics.preferredTarget)
          : (data.goal.semantics?.kind ?? 'target') === 'target'
            ? data.goal.calorieBalance
            : null,
      goalLower:
        day.goalEvaluation?.lowerBound == null ? null : Number(day.goalEvaluation.lowerBound),
      goalUpper:
        day.goalEvaluation?.upperBound == null ? null : Number(day.goalEvaluation.upperBound),
    })) ?? [];
  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={2}>Health</Title>
          <Button component={Link} href="/settings/home-assistant" variant="default">
            Home Assistant settings
          </Button>
        </Group>
        <Text c="dimmed">
          Track body composition, sleep and calorie balance. Dates use {timezone}. Gaps mean no data
          was recorded. Body composition cards and the table use the latest known reading; charts
          show actual readings only.
        </Text>
        {connection.error && (
          <Alert color="red">Could not load connection status: {connection.error.message}</Alert>
        )}
        {connection.data && (
          <Alert color="gray">
            Home Assistant: {connection.data.status}. Last reconciliation:{' '}
            {connection.data.lastSyncedAt?.toLocaleString() ?? 'never'}.{' '}
            <Anchor component={Link} href="/settings/home-assistant#sensor-diagnostics">
              Inspect mapped sensors
            </Anchor>
          </Alert>
        )}
        {connection.isSuccess && !connection.data && (
          <Alert color="gray">
            Connect Home Assistant to import your health sensors, or add readings manually below.
          </Alert>
        )}
        <Group align="flex-end">
          <TextInput
            type="date"
            label="Period ending"
            value={date}
            onChange={(e) => setDate(e.currentTarget.value)}
          />
          <SegmentedControl
            aria-label="History period"
            value={String(days)}
            onChange={(v) => setDays(Number(v) as 7 | 30)}
            data={[
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
            ]}
          />
        </Group>
        {!valid && <Alert color="yellow">Choose a valid date with enough previous days.</Alert>}
        {valid && history.isPending && <Loader />}
        {history.error && <Alert color="red">{history.error.message}</Alert>}
        {remove.error && <Alert color="red">{remove.error.message}</Alert>}
        {data && selected && (
          <>
            <Title order={3}>
              {date}
              {date === dateInTimezone(timezone) ? ' · Today (provisional)' : ''}
            </Title>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
              {(['WEIGHT', 'BODY_FAT', 'LEAN_MASS', 'SLEEP'] as const).map((metric) => {
                const record = selected.metrics[metric];
                return (
                  <Paper withBorder p="md" key={metric}>
                    <Stack gap="xs">
                      <Text c="dimmed">{metricLabels[metric]}</Text>
                      <Text size="xl" fw={600}>
                        {amount(record?.value, metricUnits[metric])}
                      </Text>
                      {record && (
                        <>
                          {record.carriedForward && (
                            <Text size="xs">Carried forward from {record.measurementDate}</Text>
                          )}
                          <Text size="xs" c="dimmed">
                            {record.source === 'manual'
                              ? 'Manual reading'
                              : 'Home Assistant · sensor state time'}{' '}
                            · {record.observedAt.toLocaleString()}
                            {record.entityId ? ` · ${record.entityId}` : ''}
                          </Text>
                          {record.source === 'manual' && !record.carriedForward && (
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              loading={remove.isPending}
                              onClick={() => remove.mutate({ id: record.id })}
                            >
                              Delete manual reading
                            </Button>
                          )}
                        </>
                      )}
                    </Stack>
                  </Paper>
                );
              })}
            </SimpleGrid>
            <Paper withBorder p="md">
              <Stack gap="xs">
                <Title order={3}>Calorie balance</Title>
                <Text>
                  Logged intake: {amount(selected.intake, 'kcal')} · Total burned:{' '}
                  {amount(selected.burned, 'kcal')}
                </Text>
                <Text size="xl">
                  {selected.balance === null
                    ? 'Waiting for intake and total burn data'
                    : `${amount(Math.abs(selected.balance), 'kcal')} ${selected.balance < 0 ? 'deficit' : selected.balance > 0 ? 'surplus' : 'balance'}`}
                </Text>
                <Text>
                  Daily goal:{' '}
                  {describeGoal(data.goal.calorieBalance?.toString() ?? null, data.goal.semantics)}{' '}
                  {data.goal.calorieBalance !== null ? 'kcal' : ''} · Difference from goal:{' '}
                  {amount(selected.differenceFromGoal, 'kcal')}
                </Text>
                {selected.goalEvaluation && (
                  <Text c={selected.goalEvaluation.color}>
                    {goalStatusLabels[selected.goalEvaluation.status]} · provisional comparison of
                    recorded data
                  </Text>
                )}
                <Text size="sm" c="dimmed">
                  Based on recorded data; missing food or delayed sensor updates make the balance
                  incomplete. Total burn includes basal metabolism. An unfinished day is not a final
                  daily result.
                </Text>
                {selected.metrics.TOTAL_CALORIES?.source === 'manual' && (
                  <Button
                    variant="subtle"
                    loading={remove.isPending}
                    onClick={() => remove.mutate({ id: selected.metrics.TOTAL_CALORIES!.id })}
                  >
                    Delete manual burn total
                  </Button>
                )}
                <Anchor component={Link} href={`/nutrition?date=${date}`}>
                  Open nutrition diary
                </Anchor>
              </Stack>
            </Paper>
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              {[
                {
                  title: 'Weight and lean mass',
                  unit: ' kg',
                  series: [
                    { name: 'weight', label: 'Weight', color: 'teal.6' },
                    { name: 'lean', label: 'Lean mass', color: 'blue.6' },
                  ],
                },
                {
                  title: 'Body fat',
                  unit: '%',
                  series: [{ name: 'fat', label: 'Body fat', color: 'grape.6' }],
                },
                {
                  title: 'Sleep',
                  unit: ' h',
                  series: [{ name: 'sleep', label: 'Sleep', color: 'indigo.6' }],
                },
                {
                  title: 'Calorie balance',
                  unit: ' kcal',
                  series: [
                    ...(data.goal.semantics?.kind === 'range' &&
                    data.goal.semantics.preferredTarget !== undefined
                      ? [{ name: 'goal', label: 'Preferred target', color: 'green.6' }]
                      : []),
                    { name: 'balance', label: 'Balance', color: 'orange.6' },
                    ...((data.goal.semantics?.kind ?? 'target') === 'target'
                      ? [{ name: 'goal', label: 'Current target', color: 'gray.6' }]
                      : [
                          ...(data.goal.semantics.kind !== 'maximum'
                            ? [{ name: 'goalLower', label: 'Goal lower bound', color: 'gray.6' }]
                            : []),
                          ...(data.goal.semantics.kind !== 'minimum'
                            ? [{ name: 'goalUpper', label: 'Goal upper bound', color: 'gray.6' }]
                            : []),
                        ]),
                  ],
                },
              ].map((item) => (
                <Paper withBorder p="md" key={item.title}>
                  <Title order={3} mb="md">
                    {item.title}
                  </Title>
                  <LineChart
                    h={220}
                    data={chart}
                    dataKey="date"
                    series={item.series}
                    unit={item.unit}
                    connectNulls={false}
                    curveType="linear"
                    withLegend
                  />
                </Paper>
              ))}
            </SimpleGrid>
            <Table.ScrollContainer minWidth={800}>
              <Table>
                <Table.Caption>
                  Latest known body composition (carried values labeled). Sleep and burn are
                  date-specific. Sensor times may differ from measurement times; sleep is grouped by
                  the sensor update date.
                </Table.Caption>
                <Table.Thead>
                  <Table.Tr>
                    {[
                      'Date',
                      'Weight',
                      'Body fat',
                      'Lean mass',
                      'Sleep',
                      'Intake',
                      'Burned',
                      'Balance',
                    ].map((label) => (
                      <Table.Th key={label}>{label}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.days.map((day) => (
                    <Table.Tr key={day.date}>
                      <Table.Td>{day.date}</Table.Td>
                      {(['WEIGHT', 'BODY_FAT', 'LEAN_MASS', 'SLEEP'] as const).map((metric) => (
                        <Table.Td key={metric}>
                          {amount(day.metrics[metric]?.value, metricUnits[metric])}
                          {day.metrics[metric]?.carriedForward && (
                            <Text size="xs" c="dimmed">
                              Carried forward from {day.metrics[metric]!.measurementDate}
                            </Text>
                          )}
                        </Table.Td>
                      ))}
                      <Table.Td>{amount(day.intake)}</Table.Td>
                      <Table.Td>{amount(day.burned)}</Table.Td>
                      <Table.Td>{amount(day.balance)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <GoalForm key={data.goal.version} initial={data.goal} />
            <ManualEntry key={date} date={date} />
          </>
        )}
      </Stack>
    </Container>
  );
}
