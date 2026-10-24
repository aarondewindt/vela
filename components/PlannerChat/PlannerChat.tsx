'use client';

import { useState } from 'react';
import { Button, Paper, Stack, Text } from '@mantine/core';
import { ConversationChat } from '../AiDevView/AiDevView';
import { ProposalWorkspace } from '../PlanningProposals/PlanningProposals';

// Application-owned content slot; future typed planning tool results can render
// ProposalWorkspace with a saved proposal ID through this same boundary.
export function PlannerChat({ date }: { date: string }) {
  const [planning, setPlanning] = useState(false);
  return (
    <ConversationChat plannerDate={date}>
      <Paper withBorder p="sm">
        <Stack gap="xs">
          <Text size="sm">
            Suggestions here do not change your schedule. Preview and approve changes with the
            planning controls.
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
