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
  Paper,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { LineChart } from '@mantine/charts';
import { trpc } from '@/lib/trpc/client';
import { historyInputSchema } from '@/lib/nutrition/reuse-schema';
import { formatNutritionAmount } from '@/lib/nutrition/format';

export function NutritionHistoryView({ initialDate }: { initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  const [days, setDays] = useState<7 | 30>(7);
  const valid = historyInputSchema.safeParse({ endDate: date, days }).success;
  const history = trpc.nutrition.getHistory.useQuery(
    { endDate: date, days },
    { enabled: valid, retry: false }
  );
  const data = valid && !history.error ? history.data : undefined;
  const chart =
    data?.days.map((day) => ({
      date: day.date.slice(5),
      calories: day.nutrients ? Number(day.nutrients.calories) : null,
      protein: day.nutrients ? Number(day.nutrients.protein) : null,
      carbohydrates: day.nutrients ? Number(day.nutrients.carbohydrates) : null,
      fat: day.nutrients ? Number(day.nutrients.fat) : null,
      fiber: day.nutrients?.fiber == null ? null : Number(day.nutrients.fiber),
    })) ?? [];
  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={2}>Nutrition history</Title>
          <Button
            component={Link}
            href={`/nutrition?date=${valid ? date : initialDate}`}
            variant="default"
          >
            Back to diary
          </Button>
        </Group>
        <Group align="flex-end">
          <TextInput
            type="date"
            label="Period ending"
            min="0001-01-07"
            max="9999-12-31"
            value={date}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDate(value);
              if (historyInputSchema.safeParse({ endDate: value, days }).success) {
                const url = new URL(window.location.href);
                url.searchParams.set('date', value);
                window.history.replaceState(null, '', url);
              }
            }}
          />
          <SegmentedControl
            aria-label="History period"
            value={String(days)}
            onChange={(value) => setDays(Number(value) as 7 | 30)}
            data={[
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
            ]}
          />
        </Group>
        <Text size="sm" c="dimmed">
          Charts show recorded intake. Gaps mean no food was logged; a logged zero stays zero. Daily
          records can be incomplete.
        </Text>
        {!valid && (
          <Alert color="yellow">Choose a valid end date with enough preceding days.</Alert>
        )}
        {valid && history.isPending && (
          <Group role="status">
            <Loader size="sm" />
            <Text>Loading nutrition history…</Text>
          </Group>
        )}
        {history.error && (
          <Alert title="Could not load history" color="red">
            {history.error.message}
            <Button variant="subtle" onClick={() => void history.refetch()}>
              Retry history
            </Button>
          </Alert>
        )}
        {data && (
          <>
            <Text>
              {data.loggedDays} of {days} days contain food entries ·{' '}
              {formatNutritionAmount(data.totals.calories)} kcal recorded
            </Text>
            {!data.loggedDays && (
              <Alert color="gray">Log food in your diary to see trends here.</Alert>
            )}
            <Paper withBorder p="md">
              <Stack>
                <Title order={3}>Calories</Title>
                <LineChart
                  h={240}
                  data={chart}
                  dataKey="date"
                  series={[{ name: 'calories', label: 'Calories', color: 'teal.6' }]}
                  unit=" kcal"
                  valueFormatter={(value) => formatNutritionAmount(String(value))}
                  connectNulls={false}
                  curveType="linear"
                  withDots
                  withLegend
                  yAxisProps={{ domain: [0, 'auto'] }}
                />
              </Stack>
            </Paper>
            <Paper withBorder p="md">
              <Stack>
                <Title order={3}>Macronutrients</Title>
                <LineChart
                  h={260}
                  data={chart}
                  dataKey="date"
                  series={[
                    { name: 'protein', label: 'Protein', color: 'blue.6' },
                    { name: 'carbohydrates', label: 'Carbohydrates', color: 'orange.6' },
                    { name: 'fat', label: 'Fat', color: 'grape.6' },
                    { name: 'fiber', label: 'Fiber', color: 'cyan.6' },
                  ]}
                  unit=" g"
                  valueFormatter={(value) => formatNutritionAmount(String(value))}
                  connectNulls={false}
                  curveType="linear"
                  withDots
                  withLegend
                  yAxisProps={{ domain: [0, 'auto'] }}
                />
              </Stack>
            </Paper>
            <Table.ScrollContainer minWidth={560}>
              <Table captionSide="top">
                <Table.Caption>
                  Daily recorded intake. Select a date to open its diary.
                </Table.Caption>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Calories</Table.Th>
                    <Table.Th>Protein</Table.Th>
                    <Table.Th>Carbs</Table.Th>
                    <Table.Th>Fat</Table.Th>
                    <Table.Th>Fiber</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.days.map((day) => (
                    <Table.Tr key={day.date}>
                      <Table.Td>
                        <Anchor component={Link} href={`/nutrition?date=${day.date}`}>
                          {day.date}
                        </Anchor>
                      </Table.Td>
                      {(['calories', 'protein', 'carbohydrates', 'fat', 'fiber'] as const).map(
                        (key) => (
                          <Table.Td key={key}>
                            {day.nutrients === null
                              ? 'Not logged'
                              : day.nutrients[key] == null
                                ? 'Unknown'
                                : `${formatNutritionAmount(day.nutrients[key])}${key === 'calories' ? ' kcal' : ' g'}`}
                          </Table.Td>
                        )
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </>
        )}
      </Stack>
    </Container>
  );
}
