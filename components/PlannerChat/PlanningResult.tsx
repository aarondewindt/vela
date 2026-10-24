'use client';

import { Button, Paper, Stack, Text } from '@mantine/core';
import { RecordResult } from './RecordResult';
import { useState } from 'react';
import { usePlanningWorkspaceStore } from '@/store/planningWorkspaceStore';
import { planningResultSchema } from '@/lib/planner/chat/result';
import { PlanReview } from '../PlanningProposals/PlanReview';
import { ProposalWorkspace } from '../PlanningProposals/PlanningProposals';

export function PlanningResult({
  value,
  onRevise,
  conversationId,
  onChoose,
}: {
  value: unknown;
  onRevise?: () => void;
  conversationId?: string;
  onChoose?: (id: string) => void;
}) {
  const parsed = planningResultSchema.safeParse(value);
  const [open, setOpen] = useState(true);
  const [correctionId, setCorrectionId] = useState<string>();
  if (!parsed.success) {
    return null;
  }
  const result = parsed.data;
  return (
    <Paper withBorder p="xs">
      <Stack gap="xs">
        <Text size="sm">
          {result.date} · {result.summary ?? result.reply.split('\n')[0]}
        </Text>
        {result.matches?.map((match) => (
          <Stack gap={2} key={match.id}>
            <Text size="sm">
              {match.label} · {match.id}
            </Text>
            {onChoose && (
              <Button size="xs" variant="subtle" onClick={() => onChoose(match.id)}>
                Use this record
              </Button>
            )}
          </Stack>
        ))}
        {result.recordProposalId && conversationId && (
          <RecordResult
            conversationId={conversationId}
            id={result.recordProposalId}
            onRevise={onRevise}
          />
        )}
        {result.review && (
          <PlanReview
            date={result.date}
            proposalId={result.review.proposalId ?? undefined}
            initialResult={result.review}
            onCreated={(id) => {
              setCorrectionId(id);
              usePlanningWorkspaceStore.getState().showPreview({ id, date: result.date });
            }}
          />
        )}
        {correctionId && (
          <ProposalWorkspace
            key={correctionId}
            date={result.date}
            previewOnly
            initialProposalId={correctionId}
            manualInitiallyOpen={false}
          />
        )}
        {result.proposalId && (
          <>
            <Button size="xs" variant="light" onClick={() => setOpen(!open)}>
              {open ? 'Hide preview' : 'Review proposal'}
            </Button>
            {open && (
              <ProposalWorkspace
                key={result.proposalId}
                date={result.date}
                previewOnly
                initialProposalId={result.proposalId}
                manualInitiallyOpen={false}
                onRevise={onRevise}
              />
            )}
            <Text size="xs" c="dimmed">
              To revise, describe the correction in chat. Only Accept applies the preview.
            </Text>
          </>
        )}
      </Stack>
    </Paper>
  );
}
