'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { trpc } from '@/lib/trpc/client';

type EditType = 'add' | 'move' | 'resize' | 'remove' | 'replace';
const actions = [
  { value: 'add', label: 'Add a task or break' },
  { value: 'move', label: 'Move a block' },
  { value: 'resize', label: 'Change a block’s duration' },
  { value: 'remove', label: 'Remove a block from the day' },
  { value: 'replace', label: 'Replace a block' },
];

export function PlanningProposals({ date }: { date: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <Button size="xs" variant="default" onClick={() => setOpened(true)}>
        Plan changes
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={`Plan changes · ${date}`}
        size="lg"
      >
        {opened && <ProposalWorkspace key={date} date={date} />}
      </Modal>
    </>
  );
}

export function ProposalWorkspace({ date }: { date: string }) {
  const utils = trpc.useUtils();
  const context = trpc.planningProposals.context.useQuery({ date }, { refetchOnMount: 'always' });
  const list = trpc.planningProposals.list.useQuery({ date }, { refetchOnMount: 'always' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const proposal = trpc.planningProposals.get.useQuery(
    { id: selectedId ?? '' },
    { enabled: Boolean(selectedId), refetchInterval: 15000 }
  );
  const [type, setType] = useState<EditType>('add');
  const [blockId, setBlockId] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [kind, setKind] = useState<'TASK' | 'REST'>('TASK');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('09:30');
  const [explanation, setExplanation] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const refresh = () =>
    Promise.all([
      utils.planningProposals.invalidate(),
      utils.planner.getDayData.invalidate(),
      utils.planner.getPlan.invalidate(),
      utils.planner.listTasks.invalidate(),
    ]);
  const create = trpc.planningProposals.createEdit.useMutation({
    onSuccess: ({ id }) => {
      setSelectedId(id);
      setRequestId(null);
      return utils.planningProposals.list.invalidate({ date });
    },
  });
  const accept = trpc.planningProposals.accept.useMutation({ onSuccess: refresh });
  const discard = trpc.planningProposals.discard.useMutation({ onSuccess: refresh });
  const error =
    context.error ?? list.error ?? proposal.error ?? create.error ?? accept.error ?? discard.error;
  const ready = context.isFetchedAfterMount && !context.error ? context.data : undefined;
  const current = !proposal.error ? proposal.data : undefined;
  const previewRef = useRef<HTMLDivElement>(null);
  const previewId = current?.id;
  useEffect(() => {
    if (previewId) {
      previewRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [previewId]);
  const busy = create.isPending || accept.isPending || discard.isPending;
  const timezone = ready?.timezone ?? current?.timezone ?? 'UTC';
  const format = (value: string, zone = current?.timezone ?? timezone) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(value));
  const changed = () => {
    setRequestId(null);
    create.reset();
  };
  return (
    <Stack>
      <Text size="sm">
        Propose a change, review the result, then apply it. Creating or discarding a proposal leaves
        your plan unchanged.
      </Text>
      <Text size="sm" c="dimmed">
        Times use {timezone}. Manual, fixed, started and historical blocks are protected.
      </Text>
      {error && (
        <Alert color="red" role="alert">
          <Text>{error.message}</Text>
          <Button
            variant="subtle"
            onClick={() => {
              setRequestId(null);
              create.reset();
              accept.reset();
              discard.reset();
              void refresh();
            }}
          >
            Refresh planning data
          </Button>
        </Alert>
      )}
      <Select
        label="Change"
        value={type}
        data={actions}
        onChange={(value) => {
          setType(value as EditType);
          changed();
        }}
        disabled={busy}
      />
      {type !== 'add' && (
        <Select
          label="Block to change"
          value={blockId}
          searchable
          data={
            ready?.blocks
              .filter((b) => b.editable)
              .map((b) => ({
                value: b.id,
                label: `${b.title} · ${format(b.startsAt, ready.timezone)}`,
              })) ?? []
          }
          onChange={(value) => {
            setBlockId(value);
            changed();
            const block = ready?.blocks.find((b) => b.id === value);
            if (block) {
              const time = (instant: string) =>
                new Intl.DateTimeFormat('en-GB', {
                  timeZone: ready!.timezone,
                  hour: '2-digit',
                  minute: '2-digit',
                  hourCycle: 'h23',
                }).format(new Date(instant));
              setStartTime(time(block.startsAt));
              setEndTime(time(block.endsAt));
            }
          }}
          disabled={busy}
        />
      )}
      {(type === 'add' || type === 'replace') && (
        <>
          <Select
            label="Add"
            value={kind}
            data={[
              { value: 'TASK', label: 'Task' },
              { value: 'REST', label: 'Break' },
            ]}
            onChange={(value) => {
              setKind(value as 'TASK' | 'REST');
              changed();
            }}
            disabled={busy}
          />
          {kind === 'TASK' && (
            <Select
              label="Task"
              value={candidateId}
              searchable
              data={ready?.candidates.map((c) => ({ value: c.id, label: c.title })) ?? []}
              onChange={(value) => {
                setCandidateId(value);
                changed();
              }}
              disabled={busy}
            />
          )}
        </>
      )}
      {type !== 'remove' && (
        <Group grow>
          <TextInput
            label="Start time"
            type="time"
            value={startTime}
            onChange={(e) => {
              setStartTime(e.currentTarget.value);
              changed();
            }}
            disabled={busy}
          />
          <TextInput
            label="End time"
            type="time"
            value={endTime}
            onChange={(e) => {
              setEndTime(e.currentTarget.value);
              changed();
            }}
            disabled={busy}
          />
        </Group>
      )}
      <Textarea
        label="Reason for this change"
        value={explanation}
        onChange={(e) => {
          setExplanation(e.currentTarget.value);
          changed();
        }}
        disabled={busy}
      />
      <Button
        loading={create.isPending}
        disabled={!ready || busy || !explanation.trim()}
        onClick={() => {
          if (!ready) {
            return;
          }
          const nextId = requestId ?? crypto.randomUUID();
          setRequestId(nextId);
          create.mutate({
            date,
            baseHash: ready.baseHash,
            requestId: nextId,
            type,
            blockId: blockId ?? undefined,
            candidateId: candidateId ?? undefined,
            kind,
            startTime,
            endTime,
            explanation,
          });
        }}
      >
        Preview change
      </Button>
      <Divider />
      <Select
        label="Saved proposals"
        placeholder={list.isLoading ? 'Loading proposals…' : 'Select a proposal'}
        value={selectedId}
        data={
          list.data?.map((p) => ({
            value: p.id,
            label: `${p.status} · ${new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(p.createdAt)}`,
          })) ?? []
        }
        onChange={(value) => {
          setSelectedId(value);
          accept.reset();
          discard.reset();
        }}
        disabled={busy}
      />
      {proposal.isFetching && selectedId && (
        <Text size="sm" role="status">
          Checking proposal…
        </Text>
      )}
      {current && (
        <Stack ref={previewRef}>
          <Badge variant="light">{current.status}</Badge>
          {current.invalidReason && <Alert color="yellow">{current.invalidReason}</Alert>}
          {current.preview.warnings.map((warning) => (
            <Alert key={warning} color="yellow">
              {warning}
            </Alert>
          ))}
          {current.preview.changes.map((change, index) => (
            <Paper key={index} withBorder p="sm">
              <Stack gap="xs">
                <Text fw={600}>
                  {actions.find((a) => a.value === change.type)?.label ?? change.type}
                </Text>
                {change.before && (
                  <Text size="sm">
                    Before: {change.before.title} · {format(change.before.startsAt)}–
                    {format(change.before.endsAt)} ({change.before.durationMinutes} min)
                  </Text>
                )}
                {change.after ? (
                  <Text size="sm">
                    After: {change.after.title} · {format(change.after.startsAt)}–
                    {format(change.after.endsAt)} ({change.after.durationMinutes} min)
                  </Text>
                ) : (
                  <Text size="sm">Removed from the day; the task is kept.</Text>
                )}
                <Text size="sm" c="dimmed">
                  {change.explanation}
                </Text>
              </Stack>
            </Paper>
          ))}
          {current.preview.remaining
            .filter((r) => r.minutes > 0)
            .map((r) => (
              <Text key={r.key} size="sm">
                {r.title}: {r.minutes} minutes remain unallocated.
              </Text>
            ))}
          {current.status === 'PENDING' && (
            <Group>
              <Button
                disabled={Boolean(current.invalidReason) || busy || proposal.isFetching}
                loading={accept.isPending}
                onClick={() => accept.mutate({ id: current.id })}
              >
                Apply changes
              </Button>
              <Button
                variant="default"
                disabled={busy}
                loading={discard.isPending}
                onClick={() => discard.mutate({ id: current.id })}
              >
                Discard proposal
              </Button>
            </Group>
          )}
          {current.receipt && (
            <Text size="sm" role="status">
              Applied {format(current.receipt.appliedAt)}.
            </Text>
          )}
        </Stack>
      )}
    </Stack>
  );
}
