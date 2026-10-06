'use client';

import type { ReactNode } from 'react';
import { ActionIcon, Box, Divider, Group, ScrollArea, Stack, Text, Textarea } from '@mantine/core';
import { IconX } from '@tabler/icons-react';

export const ROW_HEIGHT = 28;

// Right padding stays so text doesn't run under select chevrons.
export const inputStyle = {
  border: 'none',
  background: 'transparent',
  paddingInlineStart: 0,
  paddingBlock: 0,
} as const;

// Props for single-line property inputs: default variant, borderless, one line tall.
export const field = {
  size: 'sm',
  styles: { input: { ...inputStyle, height: ROW_HEIGHT, minHeight: ROW_HEIGHT } },
} as const;

export function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Text size="sm" c="dimmed" w={96} h={ROW_HEIGHT} lh={`${ROW_HEIGHT}px`} style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Group>
  );
}

export function ReadOnlyValue({ children }: { children: ReactNode }) {
  return (
    <Text size="sm" h={ROW_HEIGHT} lh={`${ROW_HEIGHT}px`}>
      {children}
    </Text>
  );
}

export function TitleField({
  value,
  label = 'Title',
  onSave,
}: {
  value: string;
  label?: string;
  onSave: (value: string) => void;
}) {
  return (
    <Textarea
      aria-label={label}
      variant="unstyled"
      autosize
      minRows={1}
      mb="xs"
      styles={{ input: { fontSize: 'var(--mantine-h3-font-size)', fontWeight: 700 } }}
      defaultValue={value}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        const next = event.currentTarget.value.trim();
        if (next && next !== value) {
          onSave(next);
        } else {
          event.currentTarget.value = value;
        }
      }}
    />
  );
}

type PropertyPanelProps = {
  // Small uppercase label in the header, e.g. "Task".
  kind: string;
  // Remounts the body when the inspected item changes so uncontrolled inputs reset.
  id: string;
  onClose: () => void;
  children: ReactNode;
  // Rendered below the property rows, e.g. a rich-text editor.
  content?: ReactNode;
};

export function PropertyPanel({ kind, id, onClose, children, content }: PropertyPanelProps) {
  return (
    <Stack h="100%" gap={0}>
      <Group justify="space-between" p="md" wrap="nowrap">
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          {kind}
        </Text>
        <ActionIcon aria-label="Close inspector" variant="subtle" color="gray" onClick={onClose}>
          <IconX size={16} />
        </ActionIcon>
      </Group>

      <ScrollArea style={{ flex: 1 }} px="md" pb="md">
        <Stack gap={2} key={id}>
          {children}
          {content && (
            <>
              <Divider my="sm" />
              {content}
            </>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
