'use client';

import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconDatabasePlus, IconRefresh, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { useAuth } from '@/hooks/auth';
import { taskSizeLabels, taskSizeValues, taskSizeLabel } from '@/lib/planner/tasks';
import { trpc } from '@/lib/trpc/client';

const initialGeneration = {
  count: 30,
  priorityWeights: [8, 18, 32, 26, 16],
  sizeWeights: [12, 26, 34, 20, 8],
  noDueDatePercent: 25,
  dueDateStartDays: -7,
  dueDateEndDays: 45,
  recurringPercent: 8,
  recurringFrequency: 'WEEKLY' as 'DAILY' | 'WEEKLY',
  dependentPercent: 25,
};

const generatedTaskSizes = taskSizeValues.filter((size) => size > 0);

function asNumber(value: number | string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(date: Date | string | null): string {
  if (!date) {
    return 'None';
  }
  return new Date(date).toLocaleDateString();
}

function formatDueDate(date: Date | string | null): string {
  if (!date) {
    return 'None';
  }
  return (typeof date === 'string' ? date : date.toISOString()).slice(0, 10);
}

export function DevToolsView() {
  const { session } = useAuth();
  const user = session.data?.user;
  const [generation, setGeneration] = useState(initialGeneration);
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const utils = trpc.useUtils();
  const testTasks = trpc.devTools.listTestTasks.useQuery(undefined, {
    enabled: Boolean(user),
  });
  const generateTasks = trpc.devTools.generateTestTasks.useMutation({
    onSuccess: async ({ count, dependencyCount }) => {
      notifications.show({
        message: `Created ${count} test tasks and ${dependencyCount} dependencies`,
        color: 'green',
      });
      await utils.devTools.listTestTasks.invalidate();
    },
    onError: (error) => notifications.show({ message: error.message, color: 'red' }),
  });
  const clearTasks = trpc.devTools.clearTestTasks.useMutation({
    onSuccess: async ({ count }) => {
      notifications.show({
        message: `Cleared ${count} test tasks and related data`,
        color: 'green',
      });
      await utils.devTools.listTestTasks.invalidate();
    },
    onError: (error) => notifications.show({ message: error.message, color: 'red' }),
  });

  const updateGeneration = <K extends keyof typeof initialGeneration>(
    key: K,
    value: (typeof initialGeneration)[K]
  ) => setGeneration((current) => ({ ...current, [key]: value }));

  const clearAll = () => {
    modals.openConfirmModal({
      title: 'Clear all test tasks',
      children: <Text size="sm">Delete every dev-tools test task and its related data?</Text>,
      labels: { confirm: 'Clear all', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => clearTasks.mutate({}),
    });
  };

  const clearRange = () => {
    if (!createdFrom || !createdTo) {
      notifications.show({ message: 'Choose both creation dates first', color: 'yellow' });
      return;
    }
    if (createdFrom > createdTo) {
      notifications.show({
        message: 'The start date must be before the end date',
        color: 'yellow',
      });
      return;
    }
    modals.openConfirmModal({
      title: 'Clear test tasks in date range',
      children: (
        <Text size="sm">
          Delete dev-tools test tasks created from {createdFrom} through {createdTo}, including
          related data?
        </Text>
      ),
      labels: { confirm: 'Clear date range', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => clearTasks.mutate({ createdFrom, createdTo }),
    });
  };

  const updateWeight = (
    kind: 'priorityWeights' | 'sizeWeights',
    index: number,
    value: number | string
  ) => {
    setGeneration((current) => {
      const weights = [...current[kind]];
      weights[index] = asNumber(value);
      return { ...current, [kind]: weights };
    });
  };

  const disabled = !user;

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={2}>Dev tools</Title>
            <Text c="dimmed" mt={4}>
              Generate and manage clearly tagged planner test data.
            </Text>
          </div>
          <Badge size="lg" variant="light" color="blue">
            {testTasks.data?.count ?? 0} test tasks
          </Badge>
        </Group>

        {!user && <Alert color="yellow">Sign in to use developer tools.</Alert>}
        {testTasks.error && <Alert color="red">{testTasks.error.message}</Alert>}

        <Paper withBorder p="md">
          <Stack gap="md">
            <div>
              <Title order={4}>Generate tasks</Title>
              <Text c="dimmed" size="sm" mt={4}>
                Generated tasks carry the <code>dev-tools-test</code> tag for safe cleanup.
              </Text>
            </div>

            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
              <NumberInput
                label="Number of tasks"
                min={1}
                max={200}
                value={generation.count}
                onChange={(value) => updateGeneration('count', asNumber(value))}
                disabled={disabled}
              />
              <NumberInput
                label="No due date (%)"
                min={0}
                max={100}
                value={generation.noDueDatePercent}
                onChange={(value) => updateGeneration('noDueDatePercent', asNumber(value))}
                disabled={disabled}
              />
              <NumberInput
                label="Recurring tasks (%)"
                min={0}
                max={100}
                value={generation.recurringPercent}
                onChange={(value) => updateGeneration('recurringPercent', asNumber(value))}
                disabled={disabled}
              />
              <Select
                label="Recurrence frequency"
                data={[
                  { value: 'DAILY', label: 'Daily' },
                  { value: 'WEEKLY', label: 'Weekly' },
                ]}
                value={generation.recurringFrequency}
                onChange={(value) => {
                  if (value === 'DAILY' || value === 'WEEKLY') {
                    updateGeneration('recurringFrequency', value);
                  }
                }}
                disabled={disabled || generation.recurringPercent === 0}
              />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
              <NumberInput
                label="Earliest due date (days from today)"
                min={-365}
                max={365}
                value={generation.dueDateStartDays}
                onChange={(value) => updateGeneration('dueDateStartDays', asNumber(value))}
                disabled={disabled}
              />
              <NumberInput
                label="Latest due date (days from today)"
                min={-365}
                max={365}
                value={generation.dueDateEndDays}
                onChange={(value) => updateGeneration('dueDateEndDays', asNumber(value))}
                disabled={disabled}
              />
              <NumberInput
                label="Tasks with a dependency (%)"
                min={0}
                max={100}
                value={generation.dependentPercent}
                onChange={(value) => updateGeneration('dependentPercent', asNumber(value))}
                disabled={disabled || generation.count < 2}
              />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <Stack gap="xs">
                <Text size="sm" fw={600}>
                  Priority distribution (relative weights)
                </Text>
                <SimpleGrid cols={5} spacing="xs">
                  {generation.priorityWeights.map((weight, index) => (
                    <NumberInput
                      key={`priority-${index + 1}`}
                      aria-label={`Priority ${index + 1} weight`}
                      label={`P${index + 1}`}
                      min={0}
                      max={100}
                      value={weight}
                      onChange={(value) => updateWeight('priorityWeights', index, value)}
                      disabled={disabled}
                    />
                  ))}
                </SimpleGrid>
              </Stack>
              <Stack gap="xs">
                <Text size="sm" fw={600}>
                  Size distribution (relative weights)
                </Text>
                <SimpleGrid cols={5} spacing="xs">
                  {generation.sizeWeights.map((weight, index) => {
                    const size = generatedTaskSizes[index];
                    return (
                      <NumberInput
                        key={`size-${size}`}
                        aria-label={`${taskSizeLabels[size]} size weight`}
                        label={taskSizeLabels[size]}
                        min={0}
                        max={100}
                        value={weight}
                        onChange={(value) => updateWeight('sizeWeights', index, value)}
                        disabled={disabled}
                      />
                    );
                  })}
                </SimpleGrid>
              </Stack>
            </SimpleGrid>

            <Group justify="flex-end">
              <Button
                leftSection={<IconDatabasePlus size={16} />}
                loading={generateTasks.isPending}
                disabled={disabled || generation.dueDateStartDays > generation.dueDateEndDays}
                onClick={() => generateTasks.mutate(generation)}
              >
                Generate test tasks
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Paper withBorder p="md">
          <Stack gap="md">
            <Group justify="space-between">
              <div>
                <Title order={4}>Test task inventory</Title>
                <Text c="dimmed" size="sm" mt={4}>
                  Only tasks marked with the reserved test tag are shown.
                </Text>
              </div>
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                onClick={() => testTasks.refetch()}
                loading={testTasks.isFetching}
                disabled={disabled}
              >
                Refresh
              </Button>
            </Group>

            <Group align="flex-end">
              <TextInput
                type="date"
                label="Created from"
                value={createdFrom}
                onChange={(event) => setCreatedFrom(event.currentTarget.value)}
                disabled={disabled}
              />
              <TextInput
                type="date"
                label="Created through"
                value={createdTo}
                onChange={(event) => setCreatedTo(event.currentTarget.value)}
                disabled={disabled}
              />
              <Button
                color="red"
                variant="light"
                leftSection={<IconTrash size={16} />}
                loading={clearTasks.isPending}
                disabled={disabled}
                onClick={clearRange}
              >
                Clear date range
              </Button>
              <Button
                color="red"
                leftSection={<IconTrash size={16} />}
                loading={clearTasks.isPending}
                disabled={disabled || !testTasks.data?.count}
                onClick={clearAll}
              >
                Clear all test tasks
              </Button>
            </Group>

            <Table.ScrollContainer minWidth={820}>
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Task</Table.Th>
                    <Table.Th>Priority</Table.Th>
                    <Table.Th>Size</Table.Th>
                    <Table.Th>Due date</Table.Th>
                    <Table.Th>Recurring</Table.Th>
                    <Table.Th>Depends on</Table.Th>
                    <Table.Th>Created</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(testTasks.data?.tasks ?? []).map((task) => (
                    <Table.Tr key={task.id}>
                      <Table.Td>{task.title}</Table.Td>
                      <Table.Td>P{task.priority}</Table.Td>
                      <Table.Td>{taskSizeLabel(task.size)}</Table.Td>
                      <Table.Td>{formatDueDate(task.dueDate)}</Table.Td>
                      <Table.Td>
                        {task.isRecurring ? task.recurrenceRule?.replace('RRULE:FREQ=', '') : 'No'}
                      </Table.Td>
                      <Table.Td>{task.dependencyCount ? 'Yes' : 'No'}</Table.Td>
                      <Table.Td>{formatDate(task.createdAt)}</Table.Td>
                    </Table.Tr>
                  ))}
                  {!testTasks.isLoading && !testTasks.data?.count && (
                    <Table.Tr>
                      <Table.Td colSpan={7}>
                        <Text c="dimmed" ta="center" py="md">
                          No test tasks found.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}
