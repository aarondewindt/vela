'use client';
import { Alert, Paper, Stack, Text } from '@mantine/core';
import { LineChart } from '@mantine/charts';
import type { CalorieTimeline } from '@/lib/health/calorie-timeline';

export function TodayBurnChart({ timeline }: { timeline?: CalorieTimeline }) {
  if (!timeline) {
    return <Alert color="gray">Samsung calorie captures unavailable</Alert>;
  }
  const time = (value: number) =>
    new Date(value).toLocaleTimeString('en-GB', {
      timeZone: timeline.timezone,
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  const ticks = [timeline.start];
  const localHour = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeline.timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  });
  for (let instant = timeline.start + 3600000; instant < timeline.end; instant += 3600000) {
    if (Number(localHour.format(new Date(instant))) % 6 === 0) {
      ticks.push(instant);
    }
  }
  ticks.push(timeline.end);
  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        {timeline.date} · {timeline.timezone}. Dots are actual midnight-to-query SDK captures;
        connecting lines do not imply intermediate measurements. Wearable data may arrive late.
      </Text>
      {timeline.points.some((p) => p.total !== null) ? (
        <LineChart
          h={240}
          data={timeline.points}
          dataKey="time"
          series={[
            { name: 'total', label: 'Observed total', color: 'orange.5' },
            { name: 'active', label: 'Active', color: 'teal.5' },
            { name: 'resting', label: 'Resting (derived)', color: 'grape.4' },
            {
              name: 'projected',
              label: 'Baseline projected total',
              color: 'blue.5',
              strokeDasharray: '3 5',
            },
          ]}
          curveType="linear"
          connectNulls={false}
          withLegend
          unit=" kcal"
          xAxisProps={{
            type: 'number',
            ticks,
            domain: [timeline.start, timeline.end],
            tickFormatter: time,
            minTickGap: 35,
          }}
          lineProps={(series) => ({ dot: series.name !== 'projected', isAnimationActive: false })}
          tooltipProps={{
            filterNull: false,
            content: ({ payload }) => {
              const point = payload?.[0]?.payload as CalorieTimeline['points'][number] | undefined;
              if (!point) {
                return null;
              }
              const value = (n: number | null) =>
                n === null ? 'Unavailable' : `${Math.round(n).toLocaleString('en-GB')} kcal`;
              return (
                <Paper withBorder p="sm" shadow="md" maw="min(24rem, calc(100vw - 3rem))">
                  <Text size="sm" fw={600}>
                    {time(point.time)}
                  </Text>
                  {point.total !== null && (
                    <>
                      <Text size="sm">Observed total: {value(point.total)}</Text>
                      <Text size="sm">Active: {value(point.active)}</Text>
                      <Text size="sm">Resting: {value(point.resting)}</Text>
                    </>
                  )}
                  {point.projected !== null && (
                    <Text size="sm" c="blue.5">
                      {point.total !== null ? 'Baseline starts at' : 'Baseline projected total'}:{' '}
                      {value(point.projected)}
                    </Text>
                  )}
                  <Text size="xs">SDK capture: {time(new Date(point.capturedAt).getTime())}</Text>
                  {point.issue && <Text size="xs">{point.issue}</Text>}
                </Paper>
              );
            },
          }}
        />
      ) : (
        <Alert color="gray">No Samsung cumulative captures for today.</Alert>
      )}
      {timeline.reason && (
        <Text size="xs" c="dimmed">
          Projection unavailable: {timeline.reason}.
        </Text>
      )}
      {timeline.projection && (
        <Text size="xs" c="dimmed">
          Baseline: {Math.round(timeline.projection.projectedTotal).toLocaleString('en-GB')} kcal at
          local day end. No additional active expenditure. Latest query cutoff{' '}
          {time(new Date(timeline.projection.cutoff).getTime())} (
          {Math.floor(timeline.projection.ageMinutes)} min before this response). BMR measured{' '}
          {new Date(timeline.projection.bmrObservedAt).toLocaleDateString('en-GB', {
            timeZone: timeline.timezone,
          })}
          .
        </Text>
      )}
      {timeline.points.some((p) => p.issue) && (
        <Text size="xs" c="dimmed">
          Some captures have missing, incompatible or invalid active values; their breakdown remains
          unavailable.
        </Text>
      )}
    </Stack>
  );
}
