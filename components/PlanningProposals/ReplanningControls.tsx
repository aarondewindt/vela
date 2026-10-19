'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import type { ReplanInput } from '@/lib/planner/proposals/schema';

export type ProgressPreset = {
  action: ReplanInput['action'];
  blockId: string;
  completeTask?: boolean;
};

type Context = {
  timezone: string;
  baseHash: string;
  blocks: { id: string; title: string; startsAt: string; status: string; adjustable: boolean }[];
  candidates: { id: string; title: string }[];
};
export function ReplanningControls({
  date,
  context,
  busy,
  submit,
  preset,
  savedId,
}: {
  date: string;
  context?: Context;
  busy: boolean;
  submit: (input: ReplanInput) => void;
  preset?: ProgressPreset;
  savedId?: string;
}) {
  const [action, setAction] = useState<ReplanInput['action']>(preset?.action ?? 'replan');
  const [blockId, setBlockId] = useState<string | null>(preset?.blockId ?? null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState(() =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: context?.timezone ?? 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date())
  );
  const [estimatedMinutes, setEstimate] = useState<number | string>('');
  const [completeTask, setCompleteTask] = useState(preset?.completeTask ?? false);
  const [pullForward, setPullForward] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  useEffect(() => {
    if (savedId) {
      setRequestId(null);
    }
  }, [savedId]);
  return (
    <Stack onChange={() => setRequestId(null)}>
      <Text size="sm">
        Review progress and changes to the remaining day. Tasks stay saved when their scheduled
        blocks are removed. Active work keeps its start; fixed and manual work moves only when
        selected explicitly.
      </Text>
      <Select
        label="Progress action"
        value={action}
        disabled={busy}
        data={[
          { value: 'replan', label: 'Replan remaining day' },
          { value: 'extend', label: 'Extend started work' },
          { value: 'finish', label: 'Finish a block' },
          { value: 'postpone', label: 'Postpone to later today' },
          { value: 'skip', label: 'Skip scheduled block · keep task' },
          { value: 'cancel', label: 'Cancel scheduled block · keep task' },
          { value: 'replace', label: 'Replace scheduled work · keep original task' },
        ]}
        onChange={(value) => {
          setAction(value as ReplanInput['action']);
          setCompleteTask(false);
          setRequestId(null);
        }}
      />
      {action !== 'replan' && (
        <Select
          label="Work to adjust"
          value={blockId}
          disabled={busy}
          searchable
          data={
            context?.blocks
              .filter((b) => b.adjustable)
              .map((b) => ({ value: b.id, label: `${b.title} · ${b.status}` })) ?? []
          }
          onChange={(value) => {
            setBlockId(value);
            setRequestId(null);
          }}
        />
      )}
      {action === 'postpone' && (
        <TextInput
          label="Later start time"
          type="time"
          value={startTime}
          disabled={busy}
          onChange={(e) => setStartTime(e.currentTarget.value)}
        />
      )}
      {(action === 'finish' || action === 'extend') && (
        <TextInput
          label={action === 'finish' ? 'Actual finish time' : 'New end time'}
          type="time"
          value={endTime}
          disabled={busy}
          onChange={(e) => setEndTime(e.currentTarget.value)}
        />
      )}
      {action === 'extend' && (
        <NumberInput
          label="New total task estimate (optional, minutes)"
          description="An explicit estimate increase is needed if the overrun exceeds remaining effort. This changes the task estimate only after acceptance."
          value={estimatedMinutes}
          min={1}
          max={525600}
          allowDecimal={false}
          disabled={busy}
          onChange={(value) => {
            setEstimate(value);
            setRequestId(null);
          }}
        />
      )}
      {action === 'finish' && (
        <Checkbox
          label="Also complete the task (only this occurrence for recurring work)"
          description="Leave unchecked to record this block’s work and keep the task open."
          checked={completeTask}
          disabled={busy}
          onChange={(e) => setCompleteTask(e.currentTarget.checked)}
        />
      )}
      {action === 'replace' && (
        <Select
          label="Replacement task"
          value={candidateId}
          disabled={busy}
          searchable
          data={context?.candidates.map((c) => ({ value: c.id, label: c.title })) ?? []}
          onChange={(value) => {
            setCandidateId(value);
            setRequestId(null);
          }}
        />
      )}
      <Checkbox
        label="Bring flexible work forward into free time"
        checked={pullForward}
        disabled={busy}
        onChange={(e) => setPullForward(e.currentTarget.checked)}
      />
      <Textarea
        label="Reason for replanning"
        value={explanation}
        disabled={busy}
        onChange={(e) => setExplanation(e.currentTarget.value)}
      />
      <Group>
        <Button
          disabled={busy || !context || !explanation.trim() || (action !== 'replan' && !blockId)}
          onClick={() => {
            if (!context) {
              return;
            }
            const id = requestId ?? crypto.randomUUID();
            setRequestId(id);
            submit({
              date,
              baseHash: context.baseHash,
              requestId: id,
              action,
              blockId: action === 'replan' ? undefined : (blockId ?? undefined),
              candidateId: action === 'replace' ? (candidateId ?? undefined) : undefined,
              startTime: action === 'postpone' ? startTime : undefined,
              endTime: action === 'finish' || action === 'extend' ? endTime : undefined,
              estimatedMinutes:
                action === 'extend' && typeof estimatedMinutes === 'number'
                  ? estimatedMinutes
                  : undefined,
              completeTask: action === 'finish' && completeTask,
              pullForward,
              explanation,
            });
          }}
        >
          Preview remaining day
        </Button>
      </Group>
    </Stack>
  );
}
