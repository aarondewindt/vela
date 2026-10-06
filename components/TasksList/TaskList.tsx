'use client';

import {
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPlus } from '@tabler/icons-react';
import { useCreateTaskMutation, useTasksQuery } from '@/lib/planner/query';

type CreateTaskValues = {
  title: string;
};

const statusLabels: Record<string, string> = {
  BACKLOG: 'Backlog',
  PAUSED: 'Paused',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  ARCHIVED: 'Archived',
};

function formatDate(date: Date | string | null) {
  if (!date) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(date));
}

export const TaskList = () => {
  const tasksQuery = useTasksQuery();
  const createTask = useCreateTaskMutation();
  const form = useForm<CreateTaskValues>({
    mode: 'uncontrolled',
    initialValues: { title: '' },
    validate: {
      title: (value) => (value.trim() ? null : 'Enter a task title'),
    },
  });

  const rows = tasksQuery.data?.map((task) => (
    <Table.Tr key={task.id}>
      <Table.Td>
        <Text fw={500}>{task.title}</Text>
        {task.brief && (
          <Text c="dimmed" size="sm" lineClamp={1}>
            {task.brief}
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        <Badge variant="light">{statusLabels[task.status] ?? task.status}</Badge>
      </Table.Td>
      <Table.Td>P{task.priority}</Table.Td>
      <Table.Td>{formatDate(task.dueDate)}</Table.Td>
      <Table.Td>{task.estimatedMinutes ? `${task.estimatedMinutes} min` : '—'}</Table.Td>
    </Table.Tr>
  ));

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Tasks</Title>
          <Text c="dimmed" size="sm">
            {tasksQuery.data ? `${tasksQuery.data.length} tasks` : 'Task inventory'}
          </Text>
        </div>
        <form
          onSubmit={form.onSubmit(({ title }) =>
            createTask.mutate({ title: title.trim() }, { onSuccess: () => form.reset() })
          )}
        >
          <Group align="flex-start" wrap="nowrap">
            <TextInput
              aria-label="New task title"
              placeholder="Add a task"
              key={form.key('title')}
              {...form.getInputProps('title')}
            />
            <Button
              type="submit"
              aria-label="Add task"
              leftSection={<IconPlus size={16} />}
              loading={createTask.isPending}
            >
              Add
            </Button>
          </Group>
        </form>
      </Group>

      {tasksQuery.error && (
        <Alert color="red" title="Could not load tasks">
          {tasksQuery.error.message}
        </Alert>
      )}
      {createTask.error && (
        <Alert color="red" title="Could not add task">
          {createTask.error.message}
        </Alert>
      )}

      {tasksQuery.isPending ? (
        <Center py="xl">
          <Loader size="sm" />
        </Center>
      ) : (
        <ScrollArea>
          <Table striped highlightOnHover miw={680} verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Task</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Priority</Table.Th>
                <Table.Th>Due date</Table.Th>
                <Table.Th>Estimate</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows?.length ? (
                rows
              ) : (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text c="dimmed" ta="center" py="lg">
                      {tasksQuery.error ? 'Tasks are unavailable.' : 'No tasks yet.'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Stack>
  );
};
