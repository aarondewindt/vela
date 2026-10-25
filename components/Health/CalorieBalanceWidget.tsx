'use client';

import { VelaGaugeChart } from '@/components/VelaGaugeChart/VelaGaugeChart';
import { Box, Stack, Text } from '@mantine/core';
import { calorieBalanceGaugeScale } from '@/lib/health/gauge-scale';
import type { GoalOptions } from '@/lib/goals/semantics';
import classes from './CalorieBalanceWidget.module.css';

interface Props {
  intake: number | null;
  burned: number | null;
  balance: number | null;
  goal: { calorieBalance: number | null; semantics?: GoalOptions };
}

const finite = (value: number | null) => value !== null && Number.isFinite(value);
const format = (value: number) =>
  new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value);

export function CalorieBalanceWidget({ intake, burned, balance, goal }: Props) {
  const options = goal.semantics;
  const scale = calorieBalanceGaugeScale({
    goalMin: goal.calorieBalance,
    goalMax: options?.kind === 'range' ? Number(options.upperBound) : null,
    // Shared goal semantics use the lower bound when no preferred target is configured.
    goalPreferred:
      options?.kind === 'range' ? Number(options.preferredTarget ?? goal.calorieBalance) : null,
    balance,
  });
  const known = finite(balance);
  const balanceLabel = known
    ? `${balance! < 0 ? '−' : '+'}${format(Math.abs(balance!))} kcal`
    : 'Unavailable';

  return (
    <Box>
      <div className={classes.layout}>
        <VelaGaugeChart
          className={classes.gauge}
          size={220}
          thickness={30}
          startAngle={-90}
          endAngle={90}
          min={0}
          max={100}
          value={scale?.target ?? 50}
          valueFormatter={() => balanceLabel}
          markers={
            scale ? [{ id: 'current', value: scale.target, size: 3, label: 'Current balance' }] : []
          }
          sections={
            scale
              ? [
                  { value: scale.goalStart, color: 'gray.6' },
                  { value: scale.goalEnd, color: 'green.6' },
                  { value: 100, color: 'gray.6' },
                ]
              : [{ value: 100, color: 'gray.6' }]
          }
          role={scale ? 'meter' : 'img'}
          aria-label="Current calorie balance"
          aria-valuenow={scale ? balance! : undefined}
          aria-valuemin={scale?.min}
          aria-valuemax={scale?.max}
          aria-valuetext={balanceLabel}
          label={
            <Stack gap={0} align="center">
              <Text fz={20} fw={650}>
                {balanceLabel}
              </Text>
              <Text size="xs" c="dimmed">
                {known
                  ? balance! < 0
                    ? 'Deficit'
                    : balance! > 0
                      ? 'Surplus'
                      : 'Balanced'
                  : 'Waiting for data'}
              </Text>
            </Stack>
          }
        />
        <div className={classes.stats}>
          {[
            { label: 'Consumed', value: intake },
            { label: 'Burned', value: burned },
          ].map(({ label, value }) => (
            <div key={label}>
              <Text size="sm" c="dimmed">
                {label}
              </Text>
              <Text className={classes.amount} fw={650}>
                {finite(value) ? format(value!) : 'Not recorded'}
                {finite(value) && (
                  <Text component="span" size="sm" c="dimmed" ml={6}>
                    kcal
                  </Text>
                )}
              </Text>
            </div>
          ))}
        </div>
      </div>
      {!known && (
        <Text size="sm" c="dimmed">
          Waiting for intake and total burn data
        </Text>
      )}
      {known && !scale && (
        <Text size="sm" c="dimmed">
          Configure a valid calorie balance range goal to show its position.
        </Text>
      )}
    </Box>
  );
}
