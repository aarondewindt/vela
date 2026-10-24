'use client';

import { Accordion, Badge, Code, Group, Stack, Text } from '@mantine/core';
import { plannerDebugSchema } from '@/lib/planner/chat/debug-schema';

export function PlannerDebug({ value }: { value: unknown }) {
  const result = plannerDebugSchema.safeParse(value);
  if (!result.success) {
    return null;
  }
  const { events, omittedEvents } = result.data;
  return (
    <Accordion variant="contained">
      <Accordion.Item value="debug">
        <Accordion.Control>Planner debug · {events.length} events</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            {omittedEvents > 0 && (
              <Text size="xs" c="dimmed">
                {omittedEvents} earlier events omitted to keep diagnostics bounded.
              </Text>
            )}
            {events.map((event) => (
              <Stack key={event.id} gap={4}>
                <Group gap="xs">
                  <Badge
                    size="xs"
                    color={event.kind === 'error' || event.kind === 'tool-error' ? 'red' : 'gray'}
                  >
                    {event.kind}
                  </Badge>
                  <Text size="xs" c="dimmed">
                    +{(event.elapsedMs / 1000).toFixed(1)}s
                  </Text>
                </Group>
                <Text size="sm" fw={500}>
                  {event.label}
                </Text>
                <Code
                  block
                  style={{
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    maxHeight: 360,
                    overflow: 'auto',
                  }}
                >
                  {event.details}
                </Code>
              </Stack>
            ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
