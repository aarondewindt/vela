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
import { goalChartReferences } from '@/lib/goals/chart-references';
import { describeGoal, goalStatusLabels } from '@/lib/goals/semantics';
import { trpc } from '@/lib/trpc/client';
import { metricKinds, metricLabels, metricUnits, type MetricKind } from '@/lib/health/schema';
import { historyInputSchema } from '@/lib/nutrition/reuse-schema';
import { dateInTimezone } from '@/lib/nutrition/dates';

const amount = (value: number | null | undefined, unit = '') =>
  value == null
    ? 'Not recorded'
    : `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value)}${unit ? ` ${unit}` : ''}`;
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
          Recorded for {date}. Samsung Health is authoritative for calories, steps, sleep and BMR.
          Manually entered values and legacy Home Assistant data fill gaps; values are never added
          across sources.
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
  const latestBurn = data?.days.findLast((day) => day.burned !== null);
  const chart =
    data?.days.map((day) => ({
      date: day.date.slice(5),
      weight: day.metrics.WEIGHT?.carriedForward ? null : (day.metrics.WEIGHT?.value ?? null),
      lean: day.metrics.LEAN_MASS?.carriedForward ? null : (day.metrics.LEAN_MASS?.value ?? null),
      fat: day.metrics.BODY_FAT?.carriedForward ? null : (day.metrics.BODY_FAT?.value ?? null),
      sleep: day.metrics.SLEEP?.value ?? null,
      steps: day.metrics.STEPS?.value ?? null,
      bmr: day.metrics.BMR?.carriedForward ? null : (day.metrics.BMR?.value ?? null),
      total: day.metrics.TOTAL_CALORIES?.value ?? null,
      active: day.metrics.ACTIVE_CALORIES?.value ?? null,
      balance: day.balance,
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
          Track Withings body composition and Samsung Health sleep, steps, BMR and calorie balance.
          Dates use {timezone}. Gaps mean no data was recorded. Body composition cards and the table
          use the latest known reading; charts show actual readings only.
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
            Connect Home Assistant for Withings weight, body fat and lean mass. Pair the Android
            companion for Samsung Health measurements.
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
              {metricKinds.map((metric) => {
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
                              : record.source === 'samsung_health'
                                ? metric === 'BMR'
                                  ? 'Samsung Health · imported BMR point (not daily expenditure)'
                                  : metric === 'SLEEP'
                                    ? 'Samsung Health · sleep-date duration'
                                    : metric === 'STEPS'
                                      ? 'Samsung Health · daily step total'
                                      : 'Samsung Health · SDK query capture · calorie semantics unverified'
                                : 'Home Assistant · sensor state time'}{' '}
                            · {record.observedAt.toLocaleString()}
                            {record.metadata &&
                            typeof record.metadata === 'object' &&
                            'timezone' in record.metadata
                              ? ` · ${String(record.metadata.timezone)}`
                              : ''}
                            {record.metadata &&
                            typeof record.metadata === 'object' &&
                            'sourceObservedAt' in record.metadata
                              ? ` · Measured ${String(record.metadata.sourceObservedAt)}`
                              : ''}
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
            <Text size="sm" c="dimmed">
              BMR is an optional Samsung body-composition reading in kcal/day, not total daily
              expenditure. Missing BMR means Samsung has not supplied a value; Vela does not
              estimate it.
            </Text>
            <Paper withBorder p="md">
              <Stack gap="xs">
                <Title order={3}>Calorie balance</Title>
                <Text>
                  Logged intake: {amount(selected.intake, 'kcal')} · Total burned:{' '}
                  {amount(selected.burned, 'kcal')}
                </Text>
                {selected.burned === null && (
                  <Alert color="gray" title={`No total burn recorded for ${selected.date}`}>
                    <Stack gap="xs">
                      <Text size="sm">
                        A successful Companion sync can contain readings for earlier dates while
                        Samsung Health has no reading for this date. Vela keeps daily burn missing
                        until a reading arrives.
                      </Text>
                      {latestBurn && (
                        <>
                          <Text size="sm">
                            Latest total in this period: {amount(latestBurn.burned, 'kcal')} on{' '}
                            {latestBurn.date}
                            {latestBurn.metrics.TOTAL_CALORIES?.source === 'samsung_health'
                              ? ' · Samsung Health'
                              : latestBurn.metrics.TOTAL_CALORIES?.source === 'manual'
                                ? ' · Manual reading'
                                : ' · Home Assistant'}
                            . This value belongs to that date.
                          </Text>
                          <Button variant="subtle" onClick={() => setDate(latestBurn.date)}>
                            View {latestBurn.date}
                          </Button>
                        </>
                      )}
                    </Stack>
                  </Alert>
                )}
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
            <Text size="xs" c="dimmed">
              Goal references: yellow minimum; green target or acceptable band; red maximum; lime
              excellent. Current goals apply to all dates.
            </Text>
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              {[
                {
                  title: 'Weight',
                  metric: 'WEIGHT' as const,
                  unit: ' kg',
                  series: [{ name: 'weight', label: 'Weight', color: 'teal.6' }],
                },
                {
                  title: 'Lean mass',
                  metric: 'LEAN_MASS' as const,
                  unit: ' kg',
                  series: [{ name: 'lean', label: 'Lean mass', color: 'blue.6' }],
                },
                {
                  title: 'Body fat',
                  metric: 'BODY_FAT' as const,
                  unit: '%',
                  series: [{ name: 'fat', label: 'Body fat', color: 'grape.6' }],
                },
                {
                  title: 'Sleep',
                  metric: 'SLEEP' as const,
                  unit: ' h',
                  series: [{ name: 'sleep', label: 'Sleep', color: 'indigo.6' }],
                },
                {
                  title: 'Steps',
                  metric: 'STEPS' as const,
                  unit: ' steps',
                  series: [{ name: 'steps', label: 'Steps', color: 'teal.6' }],
                },
                {
                  title: 'BMR',
                  metric: 'BMR' as const,
                  unit: ' kcal/day',
                  series: [{ name: 'bmr', label: 'BMR', color: 'blue.6' }],
                },
                {
                  title: 'Calories burned',
                  metric: 'TOTAL_CALORIES' as const,
                  unit: ' kcal',
                  series: [
                    { name: 'total', label: 'Total', color: 'orange.6' },
                    { name: 'active', label: 'Active (included in total)', color: 'teal.6' },
                  ],
                },
                {
                  title: 'Calorie balance',
                  metric: null,
                  unit: ' kcal',
                  series: [{ name: 'balance', label: 'Balance', color: 'orange.6' }],
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
                    {...(item.metric === null
                      ? goalChartReferences(
                          data.goal.calorieBalance?.toString() ?? null,
                          data.goal.semantics
                        )
                      : !(['WEIGHT', 'BODY_FAT', 'SLEEP'] as readonly string[]).includes(
                            item.metric
                          )
                        ? goalChartReferences(null)
                        : goalChartReferences(
                            data.goal.metricGoals?.[
                              item.metric as 'WEIGHT' | 'BODY_FAT' | 'SLEEP'
                            ]?.target?.toString() ?? null,
                            data.goal.metricGoals?.[item.metric as 'WEIGHT' | 'BODY_FAT' | 'SLEEP']
                              ?.semantics
                          ))}
                    unit={item.unit}
                    connectNulls={false}
                    curveType="linear"
                    withLegend
                    yAxisProps={{ domain: ['auto', 'auto'] }}
                  />
                </Paper>
              ))}
            </SimpleGrid>
            <Table.ScrollContainer minWidth={800}>
              <Table>
                <Table.Caption>
                  Latest known body composition and BMR (carried values labeled). Sleep uses Samsung
                  sleep dates, including overnight sessions; steps and burn are date-specific.
                  Legacy HA readings retain sensor update-date semantics. BMR is never added to
                  burn.
                </Table.Caption>
                <Table.Thead>
                  <Table.Tr>
                    {[
                      'Date',
                      'Weight',
                      'Body fat',
                      'Lean mass',
                      'Sleep',
                      'Steps',
                      'BMR',
                      'Active burn',
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
                      {(
                        [
                          'WEIGHT',
                          'BODY_FAT',
                          'LEAN_MASS',
                          'SLEEP',
                          'STEPS',
                          'BMR',
                          'ACTIVE_CALORIES',
                        ] as const
                      ).map((metric) => (
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
            <Button component={Link} href="/settings/health" variant="default">
              Edit health goals
            </Button>
            <ManualEntry key={date} date={date} />
          </>
        )}
      </Stack>
    </Container>
  );
}
