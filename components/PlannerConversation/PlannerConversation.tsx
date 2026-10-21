'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Container,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import { ProposalWorkspace } from '@/components/PlanningProposals/PlanningProposals';
import { planningCategoryLabels, taskSizeLabel, taskStatusLabels } from '@/lib/planner/tasks';
import type { RecordPreview } from '@/lib/planner/conversation/schema';

export function PlannerConversation() {
  const utils = trpc.useUtils();
  const [id, setId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [request, setRequest] = useState<{
    requestId: string;
    conversationId: string;
    revision: number;
    date: string;
    text: string;
  } | null>(null);
  const list = trpc.plannerConversation.list.useQuery();
  const current = trpc.plannerConversation.get.useQuery(
    { id: id ?? '' },
    { enabled: Boolean(id), refetchInterval: 5000 }
  );
  const settings = trpc.settings.getPreferences.useQuery();
  const create = trpc.plannerConversation.create.useMutation({
    onSuccess: async (row) => {
      setId(row.id);
      setRequest(null);
      await utils.plannerConversation.list.invalidate();
    },
  });
  const send = trpc.plannerConversation.send.useMutation({
    onSuccess: async (row) => {
      utils.plannerConversation.get.setData({ id: row.id }, row);
      setText('');
      setRequest(null);
      const last = row.turns.at(-1)?.result;
      if (last) {
        setDate(last.date);
      }
      await utils.plannerConversation.list.invalidate();
    },
  });
  const refresh = async () => {
    await Promise.all([
      utils.plannerConversation.invalidate(),
      utils.planner.invalidate(),
      utils.planningProposals.invalidate(),
      utils.taskSearch.invalidate(),
      utils.taskReviews.invalidate(),
    ]);
  };
  const accept = trpc.plannerConversation.accept.useMutation({ onSuccess: refresh });
  const discard = trpc.plannerConversation.discard.useMutation({ onSuccess: refresh });
  const error =
    settings.error ??
    list.error ??
    current.error ??
    create.error ??
    send.error ??
    accept.error ??
    discard.error;
  const timezone = settings.data?.timezone ?? 'Europe/Amsterdam';
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const busy =
    create.isPending ||
    send.isPending ||
    accept.isPending ||
    discard.isPending ||
    Boolean(current.data?.busy);
  return (
    <Container size="lg" py="md">
      <Stack>
        <Title order={2}>Planner conversation</Title>
        <Text c="dimmed">
          Plan your day, ask why tasks were chosen, or manage tasks and themes. Review and accept
          proposed changes below.
        </Text>
        <Group align="end">
          <Select
            label="Saved conversations"
            placeholder="Choose a conversation"
            value={id}
            data={
              list.data?.map((row) => ({
                value: row.id,
                label: `${row.updatedAt.toLocaleString()} · ${row.id.slice(0, 8)}`,
              })) ?? []
            }
            disabled={busy}
            onChange={(value) => {
              setId(value);
              setRequest(null);
              send.reset();
              accept.reset();
            }}
            style={{ flex: 1 }}
          />
          <Button
            variant="default"
            loading={create.isPending}
            disabled={busy}
            onClick={() => create.mutate()}
          >
            New conversation
          </Button>
        </Group>
        {error && (
          <Alert color="red" role="alert">
            {error.message}
          </Alert>
        )}
        {current.isLoading && id && <Text role="status">Loading conversation…</Text>}
        {current.data?.turns.map((turn) => (
          <Paper withBorder p="md" key={turn.id}>
            <Stack gap="sm">
              <Text fw={600}>You: {turn.text}</Text>
              {turn.status === 'GENERATING' && (
                <Text role="status">
                  {current.data?.busy
                    ? 'Preparing a reply…'
                    : 'This reply was interrupted. Send your message again.'}
                </Text>
              )}
              {turn.status === 'FAILED' && (
                <Text c="dimmed">This request failed. Your saved plan is preserved.</Text>
              )}
              {turn.result && (
                <>
                  <Text style={{ whiteSpace: 'pre-wrap' }}>{turn.result.reply}</Text>
                  <Text size="xs" c="dimmed">
                    {turn.result.date} · {turn.result.timezone} · {turn.result.model.modelId}
                  </Text>
                  {turn.result.matches?.map((match) => (
                    <Group key={match.id}>
                      <Text size="sm">
                        {match.label} · {match.id}
                      </Text>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        disabled={busy}
                        onClick={() => setText(`I mean ${match.id}.`)}
                      >
                        Use this record
                      </Button>
                    </Group>
                  ))}
                  {turn.result.details && (
                    <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                      {turn.result.details}
                    </Text>
                  )}
                  {turn.result.record && (
                    <RecordReview
                      preview={turn.result.record}
                      accepted={turn.accepted}
                      active={turn.status === 'PREVIEW'}
                      busy={busy}
                      accept={(confirmDeletion) =>
                        accept.mutate({ conversationId: id!, turnId: turn.id, confirmDeletion })
                      }
                    />
                  )}
                  {turn.result.proposalId && turn.status === 'PREVIEW' && (
                    <ProposalWorkspace
                      key={turn.result.proposalId}
                      date={turn.result.date}
                      initialProposalId={turn.result.proposalId}
                      manualInitiallyOpen={false}
                    />
                  )}
                  {turn.status === 'PREVIEW' && (
                    <Button
                      variant="default"
                      disabled={busy}
                      onClick={() => discard.mutate({ conversationId: id!, turnId: turn.id })}
                    >
                      Discard conversation preview
                    </Button>
                  )}
                  {turn.status === 'DISCARDED' && (
                    <Text size="sm" c="dimmed">
                      Preview discarded.
                    </Text>
                  )}
                  {turn.status === 'SUPERSEDED' && (
                    <Text size="sm" c="dimmed">
                      Replaced by a later preview.
                    </Text>
                  )}
                </>
              )}
            </Stack>
          </Paper>
        ))}
        {id && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!current.data || !settings.data || busy || !text.trim()) {
                return;
              }
              const input =
                request && request.text === text && request.date === (date || today)
                  ? request
                  : {
                      requestId: crypto.randomUUID(),
                      conversationId: id,
                      revision: current.data.revision,
                      date: date || today,
                      text,
                    };
              setRequest(input);
              send.mutate(input);
            }}
          >
            <Stack>
              <TextInput
                type="date"
                label={`Planning date (${timezone})`}
                value={date || today}
                onChange={(event) => setDate(event.currentTarget.value)}
                disabled={busy}
              />
              <Textarea
                label="Message"
                placeholder="Plan tomorrow, or create a task called…"
                value={text}
                onChange={(event) => setText(event.currentTarget.value)}
                disabled={busy}
                autosize
                minRows={3}
                maxLength={2000}
              />
              <Button
                type="submit"
                disabled={busy || !settings.data || !text.trim()}
                loading={send.isPending}
              >
                Send message
              </Button>
              {busy && (
                <Text role="status">Preparing your preview. This can take a few minutes.</Text>
              )}
            </Stack>
          </form>
        )}
      </Stack>
    </Container>
  );
}

export function RecordReview({
  preview,
  accepted,
  active,
  busy,
  accept,
}: {
  preview: RecordPreview;
  accepted: boolean;
  active: boolean;
  busy: boolean;
  accept: (confirmed: boolean) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const deleted = preview.action === 'delete';
  const fields = deleted
    ? Object.entries(preview.before ?? {}).filter(([key]) =>
        ['id', 'title', 'name', 'status', 'themeId'].includes(key)
      )
    : Object.entries(preview.patch);
  const labels: Record<string, string> = {
    id: 'Record ID',
    title: 'Title',
    brief: 'Brief',
    status: 'Status',
    priority: 'Priority',
    size: 'Size',
    dueDate: 'Due date',
    estimatedMinutes: 'Estimate (minutes)',
    leadTimeDays: 'Lead time (days)',
    themeId: 'Theme',
    category: 'Category',
    tags: 'Tags',
    name: 'Name',
    color: 'Color',
    isActive: 'Active',
  };
  const display = (value: unknown, key: string): string => {
    if (value === null || value === undefined) {
      return 'Clear / inherit';
    }
    if (key === 'themeId' && typeof value === 'string') {
      return preview.references?.[value] ?? value;
    }
    if (key === 'priority') {
      return `P${value}`;
    }
    if (key === 'size' && typeof value === 'number') {
      return taskSizeLabel(value);
    }
    if (key === 'status') {
      return taskStatusLabels[value as keyof typeof taskStatusLabels] ?? String(value);
    }
    if (key === 'category') {
      return planningCategoryLabels[value as keyof typeof planningCategoryLabels] ?? String(value);
    }
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }
    return Array.isArray(value) ? value.join(', ') : String(value);
  };

  return (
    <Stack gap="xs">
      <Text fw={600}>
        {preview.action} {preview.entity}:{' '}
        {String(
          preview.before?.title ??
            preview.before?.name ??
            preview.patch.title ??
            preview.patch.name ??
            ''
        )}
      </Text>
      {fields.map(([key, value]) => (
        <Text size="sm" key={key}>
          {labels[key] ?? key}:{' '}
          {preview.before && !deleted ? `${display(preview.before[key], key)} → ` : ''}
          {display(value, key)}
        </Text>
      ))}
      {preview.warnings.map((warning) => (
        <Alert color="yellow" key={warning}>
          {warning}
        </Alert>
      ))}
      {accepted ? (
        <Text role="status">Changes accepted.</Text>
      ) : (
        active && (
          <>
            {deleted && (
              <Checkbox
                label={`I confirm deletion of this ${preview.entity}`}
                checked={confirmed}
                onChange={(event) => setConfirmed(event.currentTarget.checked)}
                disabled={busy}
              />
            )}
            <Button
              color={deleted ? 'red' : undefined}
              disabled={busy || (deleted && !confirmed)}
              onClick={() => accept(confirmed)}
            >
              {deleted ? 'Confirm deletion' : 'Accept changes'}
            </Button>
          </>
        )
      )}
    </Stack>
  );
}
