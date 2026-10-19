'use client';

import { useId, useState } from 'react';
import { Button, Code, Stack, Text } from '@mantine/core';
import type { MealDraft } from '@/lib/nutrition/drafts';

export function MealTurnDiagnostics({ turn }: { turn: MealDraft['turns'][number] }) {
  const [opened, setOpened] = useState(false);
  const id = useId();
  return (
    <Stack gap="xs">
      <Button
        size="xs"
        variant="subtle"
        w="fit-content"
        aria-expanded={opened}
        aria-controls={id}
        onClick={() => setOpened((value) => !value)}
      >
        {opened ? 'Hide debug details' : 'Show debug details'}
      </Button>
      {opened && (
        <Stack id={id} gap="xs">
          {!turn.diagnostics && (
            <Text size="xs" c="dimmed">
              No model diagnostics were captured for this attempt. Retry the message to capture a
              new response.
            </Text>
          )}
          <Code block style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {JSON.stringify(
              {
                messageId: turn.id,
                status: turn.status,
                provider: turn.provider,
                modelId: turn.modelId,
                error: turn.error,
                generation: turn.diagnostics ?? null,
              },
              null,
              2
            )}
          </Code>
        </Stack>
      )}
    </Stack>
  );
}
