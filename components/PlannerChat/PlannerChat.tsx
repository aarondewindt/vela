'use client';

import { useState } from 'react';
import { Button, Paper, Stack, Text } from '@mantine/core';
import { ConversationChat } from '../AiDevView/AiDevView';
import { ProposalWorkspace } from '../PlanningProposals/PlanningProposals';

// Non-chat entry points remain available alongside inline tool result cards.
export function PlannerChat({ date }: { date: string }) {
  const [planning, setPlanning] = useState(false);
  return (
    <ConversationChat plannerDate={date}>
      <Paper withBorder p="sm">
        <Stack gap="xs">
          <Text size="sm">
            Chat creates proposals for review. Your schedule changes only when you explicitly apply
            a validated preview.
          </Text>
          <Button variant="light" size="xs" onClick={() => setPlanning((value) => !value)}>
            {planning ? 'Hide planning controls' : 'Generate · Review schedule · Replan'}
          </Button>
          {planning && <ProposalWorkspace key={date} date={date} manualInitiallyOpen={false} />}
        </Stack>
      </Paper>
    </ConversationChat>
  );
}
