'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Group, Paper, Select, Stack, Text, Textarea } from '@mantine/core';
import { trpc } from '@/lib/trpc/client';

export function PlanReview({
  date,
  proposalId,
  onCreated,
}: {
  date: string;
  proposalId?: string;
  onCreated: (id: string) => void;
}) {
  const [guidance, setGuidance] = useState('');
  const [mode, setMode] = useState<'deterministic' | 'ai'>('deterministic');
  const [target, setTarget] = useState('current');
  const [request, setRequest] = useState<{ index: number; id: string } | null>(null);
  const utils = trpc.useUtils();
  const review = trpc.planningProposals.review.useMutation();
  const create = trpc.planningProposals.create.useMutation({
    onSuccess: async ({ id }) => {
      await utils.planningProposals.list.invalidate({ date });
      onCreated(id);
    },
  });
  const result = review.data;
  const busy = review.isPending || create.isPending;
  const reset = () => {
    review.reset();
    create.reset();
    setRequest(null);
  };
  const titles = (ids: string[]) =>
    ids.map((id) => result?.blocks.find((b) => b.id === id)?.title ?? id).join(', ');
  return (
    <Stack>
      <Text size="sm">
        Review conflicts and contextual concerns, then preview an individual correction. Your plan
        changes only after you apply that proposal.
      </Text>
      <Select
        label="Plan to review"
        value={target}
        data={[
          { value: 'current', label: 'Current day plan' },
          ...(proposalId ? [{ value: proposalId, label: 'Selected pending proposal' }] : []),
        ]}
        disabled={busy}
        onChange={(value) => {
          setTarget(value ?? 'current');
          reset();
        }}
      />
      <Select
        label="Review method"
        value={mode}
        data={[
          { value: 'deterministic', label: 'Verified conflicts only' },
          { value: 'ai', label: 'Verified conflicts and AI concerns' },
        ]}
        disabled={busy}
        onChange={(value) => {
          setMode(value as typeof mode);
          reset();
        }}
      />
      <Textarea
        label="Review guidance"
        value={guidance}
        maxLength={2000}
        disabled={busy || mode !== 'ai'}
        onChange={(event) => {
          setGuidance(event.currentTarget.value);
          reset();
        }}
      />
      <Button
        loading={review.isPending}
        disabled={busy || (target !== 'current' && target !== proposalId)}
        onClick={() => {
          setRequest(null);
          create.reset();
          review.mutate({
            date,
            ...(target !== 'current' ? { proposalId: target } : {}),
            mode,
            guidance: mode === 'ai' ? guidance : '',
          });
        }}
      >
        Review day plan
      </Button>
      {(review.error || create.error) && (
        <Alert color="red" role="alert">
          {(review.error ?? create.error)?.message}
        </Alert>
      )}
      {result && (
        <>
          <Text size="xs" c="dimmed">
            Reviewed {new Date(result.reviewedAt).toLocaleString()} · {result.timezone}
            {result.model ? ` · ${result.model.modelId}` : ''}. Inputs and time are rechecked when
            previewing and applying.
          </Text>
          <Text fw={600}>Verified conflicts</Text>
          {!result.conflicts.length && (
            <Text size="sm">No conflicts found by the supported checks.</Text>
          )}
          {result.conflicts.map((concern, i) => (
            <Paper key={i} withBorder p="sm">
              <Badge>Verified · {concern.code}</Badge>
              <Text fw={500}>{titles(concern.blockIds)}</Text>
              <Text size="sm">{concern.explanation}</Text>
            </Paper>
          ))}
          <Text fw={600}>AI concerns · advisory</Text>
          {result.aiError && (
            <Alert color="yellow">
              AI review unavailable: {result.aiError} Verified results remain available.
            </Alert>
          )}
          {result.mode === 'deterministic' ? (
            <Text size="sm">AI review was not requested.</Text>
          ) : (
            !result.aiError &&
            !result.concerns.length && <Text size="sm">No contextual concerns returned.</Text>
          )}
          {result.concerns.map((concern, i) => (
            <Paper key={i} withBorder p="sm">
              <Badge variant="outline">AI concern</Badge>
              <Text fw={500}>{titles(concern.blockIds)}</Text>
              <Text size="sm">{concern.explanation}</Text>
            </Paper>
          ))}
          {result.warnings.map((warning) => (
            <Text key={warning} size="sm">
              {warning}
            </Text>
          ))}
          <Text fw={600}>Validated correction options</Text>
          <Text size="sm">
            Each option is checked independently against the complete schedule. Protected blocks
            require the existing explicit progress/manual workflow. Replacing work does not ensure
            its deadline will be met.
          </Text>
          {!result.corrections.length && (
            <Text size="sm">
              No individual correction fits. Multiple conflicts may require a combined manual
              proposal or remaining-day replanning.
            </Text>
          )}
          {result.corrections.map((correction, index) => (
            <Paper key={index} withBorder p="sm">
              <Stack gap="xs">
                <Text fw={500}>{correction.title}</Text>
                <Text size="sm">{correction.explanation}</Text>
                <Text size="sm">
                  Displaced: {correction.displaced.title} · {correction.displaced.minutes} minutes
                  released
                  {correction.displaced.due
                    ? ` · due ${correction.displaced.due}`
                    : ' · no recorded deadline'}
                  {correction.displaced.deadlineRisk
                    ? ' · due by this day; deferral risks the deadline'
                    : ''}
                  .
                </Text>
                {correction.replacement && (
                  <Text size="sm">
                    Replacement: {correction.replacement.minutes} minutes ·{' '}
                    {correction.replacement.remainingMinutes} unallocated minutes after this slot
                    {correction.replacement.due
                      ? ` · due ${correction.replacement.due}`
                      : ' · no recorded deadline'}
                    {correction.replacement.deadlineRisk
                      ? ' · due by this day; completion still requires execution'
                      : ''}
                    .
                  </Text>
                )}
                <Group>
                  <Button
                    variant="default"
                    size="xs"
                    loading={create.isPending && request?.index === index}
                    disabled={busy}
                    onClick={() => {
                      const id = request?.index === index ? request.id : crypto.randomUUID();
                      setRequest({ index, id });
                      create.mutate({
                        requestId: id,
                        date,
                        baseHash: result.baseHash,
                        document: correction.document,
                      });
                    }}
                  >
                    Preview correction
                  </Button>
                </Group>
              </Stack>
            </Paper>
          ))}
        </>
      )}
    </Stack>
  );
}
