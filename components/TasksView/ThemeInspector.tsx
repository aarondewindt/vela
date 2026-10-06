'use client';

import {
  ActionIcon,
  ColorInput,
  Group,
  ScrollArea,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { useUpdateThemeMutation } from '@/lib/planner/query';
import type { TaskRow, ThemeRow } from '@/lib/planner/tasks';
import { formatDateTime } from './format';

type Props = {
  theme: ThemeRow;
  tasks: TaskRow[];
  onClose: () => void;
};

export function ThemeInspector({ theme, tasks, onClose }: Props) {
  const update = useUpdateThemeMutation();
  const save = (patch: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate({ id: theme.id, patch });

  const open = tasks.filter((t) => t.status !== 'DONE' && t.status !== 'ARCHIVED').length;

  return (
    <Stack h="100%" gap={0}>
      <Group justify="space-between" p="md" wrap="nowrap">
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          Theme
        </Text>
        <ActionIcon aria-label="Close inspector" variant="subtle" color="gray" onClick={onClose}>
          <IconX size={16} />
        </ActionIcon>
      </Group>

      <ScrollArea style={{ flex: 1 }} px="md" pb="md">
        <Stack gap="sm" key={theme.id}>
          <TextInput
            aria-label="Name"
            variant="unstyled"
            styles={{ input: { fontSize: 'var(--mantine-h3-font-size)', fontWeight: 700 } }}
            defaultValue={theme.name}
            onBlur={(event) => {
              const name = event.currentTarget.value.trim();
              if (name && name !== theme.name) {
                save({ name });
              } else {
                event.currentTarget.value = theme.name;
              }
            }}
          />
          <Text size="sm" c="dimmed">
            {open} open · {tasks.length} total tasks
          </Text>
          <ColorInput
            label="Color"
            defaultValue={theme.color ?? ''}
            onChangeEnd={(color) => save({ color: color || null })}
          />
          <Textarea
            label="Brief"
            autosize
            minRows={3}
            defaultValue={theme.brief ?? ''}
            onBlur={(event) => {
              const brief = event.currentTarget.value.trim() || null;
              if (brief !== theme.brief) {
                save({ brief });
              }
            }}
          />
          <Switch
            label="Active"
            checked={theme.isActive}
            onChange={(event) => save({ isActive: event.currentTarget.checked })}
          />
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Created {formatDateTime(theme.createdAt)}
            </Text>
            <Text size="xs" c="dimmed">
              Updated {formatDateTime(theme.updatedAt)}
            </Text>
          </Stack>
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
