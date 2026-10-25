'use client';

import { TodayBurnChart } from './TodayBurnChart';
import type { CalorieTimeline } from '@/lib/health/calorie-timeline';
import { useState } from 'react';
import { Paper, SegmentedControl, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { BarChart, LineChart } from '@mantine/charts';
import { goalChartReferences } from '@/lib/goals/chart-references';
import type { GoalOptions } from '@/lib/goals/semantics';
import type { MetricGoals } from '@/lib/health/schema';
import type { aggregateHealthHistory, HistoryField } from '@/lib/health/history-aggregation';

type History = ReturnType<typeof aggregateHealthHistory> & { todayBurn?: CalorieTimeline };
type Point = History['points'][number];
type Goal = { calorieBalance: number | null; semantics?: GoalOptions; metricGoals?: MetricGoals };
const format = (value: number | null) =>
  value === null
    ? 'Not recorded'
    : new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value);

function HistoryTooltip({
  payload,
  field,
  unit,
}: {
  payload?: readonly { payload?: Point }[];
  field: HistoryField | 'burn' | 'balance';
  unit: string;
}) {
  const point = payload?.[0]?.payload;
  if (!point) {
    return null;
  }
  return (
    <Paper withBorder p="sm" shadow="md" maw="min(24rem, calc(100vw - 3rem))">
      <Text size="sm" fw={600}>
        {point.date}
      </Text>
      {field === 'burn' ? (
        <>
          <Text size="sm">
            Recorded total: {format(point.total)} {unit}
          </Text>
          <Text size="sm">
            Active: {format(point.active)} {unit} · Resting: {format(point.resting)} {unit}
          </Text>
          <Text size="xs">
            {point.burnedDays}/{point.expectedDays} days with total burn ·{' '}
            {point.completeBurnDays < point.expectedDays || point.provisional
              ? 'Partial period'
              : 'Recorded period'}
          </Text>
          {point.unsplit !== null && (
            <Text size="xs">Active/resting decomposition unavailable</Text>
          )}
        </>
      ) : field === 'balance' ? (
        <>
          <Text size="sm">
            Balance: {format(point.balance)} {unit}
          </Text>
          <Text size="xs">
            {point.balanceDays}/{point.expectedDays} past days with intake and burn
          </Text>
          {point.balance === null && <Text size="xs">Incomplete period; no total shown</Text>}
        </>
      ) : (
        <>
          <Text size="sm">
            {format(point[field])} {unit}
          </Text>
          <Text size="xs">
            {point.statistics[field].count}/{point.expectedDays} days recorded
          </Text>
          <Text size="xs">
            Observed range: {format(point.statistics[field].min)} –{' '}
            {format(point.statistics[field].max)} {unit}
          </Text>
        </>
      )}
      {point.provisional && <Text size="xs">Includes today; updates may arrive late</Text>}
    </Paper>
  );
}

export function HealthHistoryCharts({
  history,
  goal,
}: {
  history: History;
  goal: Goal;
  today: string;
  timezone: string;
}) {
  const [burnView, setBurnView] = useState('history');
  const daily = history.aggregation === 'daily';
  const grouping = daily
    ? 'Daily'
    : history.aggregation === 'weekly'
      ? 'Weekly'
      : history.monthStep === 1
        ? 'Monthly'
        : `${history.monthStep}-month`;
  const xAxisProps = {
    minTickGap: 20,
    tickFormatter: (value: string) =>
      history.aggregation === 'monthly' ? value.slice(0, 7) : value.slice(5, 10),
  };
  return (
    <>
      <Text size="sm" c="dimmed">
        {grouping} history.{' '}
        {daily
          ? 'Actual daily readings.'
          : 'Body, sleep, steps and BMR show means of recorded daily readings; tooltips include coverage and observed ranges.'}{' '}
        Burn bars sum recorded totals; partial periods are labeled. Balance is intake − total burn,
        summed only when every day has both values, is in the past, and Samsung burn covers the full
        source day. Food logs do not establish a complete diary.
        {daily ? '' : ' Daily balance goals are hidden for multi-day sums.'}
      </Text>
      <Text size="xs" c="dimmed">
        Goal references: yellow minimum; green target or acceptable band; red maximum; lime
        excellent. Current goals apply to all dates
        {daily ? '.' : '; sleep goals refer to daily means.'}
      </Text>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        {[
          { title: 'Weight', field: 'weight', metric: 'WEIGHT', unit: 'kg', color: 'teal.6' },
          { title: 'Lean mass', field: 'lean', metric: null, unit: 'kg', color: 'blue.6' },
          { title: 'Body fat', field: 'fat', metric: 'BODY_FAT', unit: '%', color: 'grape.6' },
          { title: 'Sleep', field: 'sleep', metric: 'SLEEP', unit: 'h', color: 'indigo.6' },
          { title: 'Steps', field: 'steps', metric: null, unit: 'steps', color: 'teal.6' },
          { title: 'BMR', field: 'bmr', metric: null, unit: 'kcal/day', color: 'blue.6' },
        ].map(({ title, field, metric, unit, color }) => {
          const target = metric ? goal.metricGoals?.[metric as keyof MetricGoals] : undefined;
          return (
            <Paper withBorder p="md" key={field} miw={0}>
              <Title order={3} mb="md">
                {title}
              </Title>
              <LineChart
                h={220}
                data={history.points}
                dataKey="date"
                series={[{ name: field, label: title, color }]}
                {...goalChartReferences(target?.target?.toString() ?? null, target?.semantics)}
                unit={` ${unit}`}
                connectNulls={false}
                curveType="linear"
                withLegend
                withDots={daily}
                yAxisProps={{ domain: ['auto', 'auto'] }}
                xAxisProps={xAxisProps}
                tooltipProps={{
                  filterNull: false,
                  content: ({ payload }) => (
                    <HistoryTooltip payload={payload} field={field as HistoryField} unit={unit} />
                  ),
                }}
              />
            </Paper>
          );
        })}
        <Paper withBorder p="md" miw={0}>
          <Stack gap="sm">
            <Title order={3}>Calories burned</Title>
            <SegmentedControl
              aria-label="Calories burned view"
              value={burnView}
              onChange={setBurnView}
              data={[
                { value: 'history', label: 'History' },
                { value: 'today', label: 'Today' },
              ]}
            />
            {burnView === 'today' ? (
              <TodayBurnChart timeline={history.todayBurn} />
            ) : (
              <>
                <Text size="xs" c="dimmed">
                  {grouping} recorded sums in kcal. Active + resting = total only for compatible,
                  verified data. Orange bars show unsplit totals when corresponding active readings
                  are missing, incompatible or invalid. Manual and legacy totals do not establish a
                  compatible split.
                </Text>
                <BarChart
                  h={220}
                  data={history.points}
                  dataKey="date"
                  type="stacked"
                  series={[
                    { name: 'resting', label: 'Resting / non-active (derived)', color: 'blue.6' },
                    { name: 'active', label: 'Active', color: 'teal.6' },
                    { name: 'unsplit', label: 'Total (unsplit)', color: 'orange.6' },
                  ]}
                  unit=" kcal"
                  withLegend
                  xAxisProps={xAxisProps}
                  tooltipProps={{
                    filterNull: false,
                    content: ({ payload }) => (
                      <HistoryTooltip payload={payload} field="burn" unit="kcal" />
                    ),
                  }}
                />
                {history.points.some(
                  (point) => point.completeBurnDays < point.expectedDays || point.provisional
                ) && (
                  <Text size="xs" c="dimmed">
                    Partial data: some periods have missing days, partial-day snapshots or include
                    today. Bars show recorded sums only; hover for coverage.
                  </Text>
                )}
              </>
            )}
          </Stack>
        </Paper>
        <Paper withBorder p="md" miw={0}>
          <Title order={3} mb="md">
            Calorie balance
          </Title>
          <Text size="xs" c="dimmed" mb="sm">
            {grouping} {daily ? 'balance' : 'sum'} in kcal · negative = deficit; positive = surplus.
            Incomplete periods and today remain gaps.
          </Text>
          <BarChart
            h={220}
            data={history.points}
            dataKey="date"
            series={[{ name: 'balance', label: 'Balance', color: 'orange.6' }]}
            {...goalChartReferences(
              daily ? (goal.calorieBalance?.toString() ?? null) : null,
              goal.semantics
            )}
            unit=" kcal"
            withLegend
            yAxisProps={{ domain: ['auto', 'auto'] }}
            xAxisProps={xAxisProps}
            tooltipProps={{
              filterNull: false,
              content: ({ payload }) => (
                <HistoryTooltip payload={payload} field="balance" unit="kcal" />
              ),
            }}
          />
        </Paper>
      </SimpleGrid>
    </>
  );
}
