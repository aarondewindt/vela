'use client';

import { useState } from 'react';
import { useClickOutside, useHotkeys } from '@mantine/hooks';
import { VelaGaugeChart } from '@/components/VelaGaugeChart/VelaGaugeChart';
import { Box, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import type { BurnProjection } from '@/lib/health/calorie-projection';
import { calorieBalanceGaugeScale } from '@/lib/health/gauge-scale';
import type { GoalOptions } from '@/lib/goals/semantics';
import classes from './CalorieBalanceWidget.module.css';

interface Props {
  projection?: BurnProjection | null;
  burnedUpdatedAt?: Date | null;
  intake: number | null;
  burned: number | null;
  balance: number | null;
  goal: { calorieBalance: number | null; semantics?: GoalOptions };
}

const finite = (value: number | null) => value !== null && Number.isFinite(value);
const format = (value: number) =>
  new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(value);

const formatBalance = (value: number) => `${value < 0 ? '−' : '+'}${format(Math.abs(value))} kcal`;

type BalanceTarget = { label: string; value: number };

function BalanceLabel({
  value,
  label,
  targets,
  color,
}: {
  value: number | null;
  label: string;
  targets: BalanceTarget[];
  color?: string;
}) {
  const [opened, setOpened] = useState(false);
  const ref = useClickOutside<HTMLButtonElement>(() => setOpened(false));
  useHotkeys([['Escape', () => setOpened(false)]]);
  const text = (
    <Text fz={20} fw={650} c={color}>
      {finite(value) ? formatBalance(value!) : 'Unavailable'}
    </Text>
  );
  if (!finite(value) || !targets.length) {
    return text;
  }
  return (
    <Tooltip
      opened={opened}
      position="top"
      withArrow
      multiline
      maw="calc(100vw - 2rem)"
      label={
        <Stack gap={4}>
          <Text size="sm" fw={600}>
            {label}
          </Text>
          {targets.map((target) => {
            const difference = target.value - value!;
            const amount = format(Math.abs(difference));
            return (
              <Text size="xs" key={target.label}>
                {target.label} ({formatBalance(target.value)}):{' '}
                {difference === 0
                  ? 'At target'
                  : `${difference > 0 ? 'Eat' : 'Burn'} ${amount} kcal`}
              </Text>
            );
          })}
        </Stack>
      }
    >
      <UnstyledButton
        ref={ref}
        aria-label={label}
        onClick={() => setOpened(true)}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') {
            setOpened(true);
          }
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') {
            setOpened(false);
          }
        }}
        onFocus={() => setOpened(true)}
        onBlur={() => setOpened(false)}
      >
        {text}
      </UnstyledButton>
    </Tooltip>
  );
}

export function CalorieBalanceWidget({
  intake,
  burned,
  balance,
  goal,
  projection,
  burnedUpdatedAt,
}: Props) {
  const projectedBalance =
    projection && finite(intake) ? intake! - projection.projectedTotal : null;
  const options = goal.semantics;
  const scale = calorieBalanceGaugeScale({
    goalMin: goal.calorieBalance,
    goalMax: options?.kind === 'range' ? Number(options.upperBound) : null,
    // Shared goal semantics use the lower bound when no preferred target is configured.
    goalPreferred:
      options?.kind === 'range' ? Number(options.preferredTarget ?? goal.calorieBalance) : null,
    balance,
    projectedBalance,
  });
  const targets: BalanceTarget[] =
    scale && options?.kind === 'range'
      ? [
          { label: 'Minimum', value: goal.calorieBalance! },
          { label: 'Preferred', value: Number(options?.preferredTarget ?? goal.calorieBalance) },
          { label: 'Maximum', value: Number(options?.upperBound) },
        ]
      : [];
  const known = finite(balance);
  const balanceLabel = known ? formatBalance(balance!) : 'Unavailable';
  const lastBurnUpdate = burnedUpdatedAt ?? (projection ? new Date(projection.capturedAt) : null);
  const updateLabel = lastBurnUpdate
    ? `Last updated: ${lastBurnUpdate.toLocaleString('en-GB', {
        timeZone: projection?.timezone,
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      })}`
    : null;

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
          valueFormatter={(value) =>
            value === scale?.projectedTarget && projectedBalance !== null
              ? formatBalance(projectedBalance)
              : balanceLabel
          }
          markers={
            scale
              ? [
                  { id: 'current', value: scale.target, size: 3, label: 'Current balance' },
                  ...(scale.projectedTarget !== null
                    ? [
                        {
                          id: 'projected',
                          value: scale.projectedTarget,
                          color: 'blue.5',
                          size: 3,
                          label: 'Baseline projected balance',
                        },
                      ]
                    : []),
                ]
              : []
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
            <Stack
              gap={0}
              align="center"
              className={projectedBalance !== null ? classes.balances : undefined}
            >
              <BalanceLabel value={balance} label="Current balance" targets={targets} />
              {projectedBalance !== null && (
                <BalanceLabel
                  value={projectedBalance}
                  label="Baseline projected balance"
                  targets={targets}
                  color="blue.5"
                />
              )}
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
              <Tooltip
                label={updateLabel}
                position="top"
                withArrow
                disabled={label !== 'Burned' || !updateLabel}
                events={{ hover: true, focus: true, touch: true }}
              >
                <Text
                  className={classes.amount}
                  fw={650}
                  tabIndex={label === 'Burned' && updateLabel ? 0 : undefined}
                >
                  {finite(value) ? format(value!) : 'Not recorded'}
                  {finite(value) && (
                    <Text component="span" size="sm" c="dimmed">
                      kcal
                    </Text>
                  )}
                </Text>
              </Tooltip>
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
