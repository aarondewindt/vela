'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Accordion,
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
import { usePlanningWorkspaceStore } from '@/store/planningWorkspaceStore';
import { trpc } from '@/lib/trpc/client';
import { ReplanningControls, type ProgressPreset } from './ReplanningControls';
import type { GenerationReport } from '@/lib/planner/proposals/schema';
import { PlanReview } from './PlanReview';

type EditType = 'add' | 'move' | 'resize' | 'remove' | 'replace';
const actions = [
  { value: 'add', label: 'Add a task or break' },
  { value: 'move', label: 'Move a block' },
  { value: 'resize', label: 'Change a block’s duration' },
  { value: 'remove', label: 'Remove a block from the day' },
  { value: 'replace', label: 'Replace a block' },
];

export function PlanningProposals({
  date,
  label = 'Plan changes',
  preset,
}: {
  date: string;
  label?: string;
  preset?: ProgressPreset;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <Button size="xs" variant="default" onClick={() => setOpened(true)}>
        {label}
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={`${label} · ${date}`}
        size="lg"
      >
        {opened && (
          <ProposalWorkspace
            key={date}
            date={date}
            manualInitiallyOpen={label !== 'Generate plan'}
            preset={preset}
          />
        )}
      </Modal>
    </>
  );
}

export function ProposalWorkspace({
  date,
  manualInitiallyOpen = true,
  preset,
  initialProposalId,
  onRevise,
  previewOnly = false,
}: {
  date: string;
  manualInitiallyOpen?: boolean;
  preset?: ProgressPreset;
  initialProposalId?: string;
  onRevise?: () => void;
  previewOnly?: boolean;
}) {
  const focus = usePlanningWorkspaceStore((state) => state.focus);
  const showPreview = usePlanningWorkspaceStore((state) => state.showPreview);
  const utils = trpc.useUtils();
  const context = trpc.planningProposals.context.useQuery({ date }, { refetchOnMount: 'always' });
  const list = trpc.planningProposals.list.useQuery({ date }, { refetchOnMount: 'always' });
  const [selectedId, setSelectedId] = useState<string | null>(initialProposalId ?? null);
  const [mode, setMode] = useState<'ai' | 'deterministic'>('ai');
  const [guidance, setGuidance] = useState('');
  const [generationRequestId, setGenerationRequestId] = useState<string | null>(null);
  const [emptyReport, setEmptyReport] = useState<GenerationReport | null>(null);
  const generate = trpc.planningProposals.generate.useMutation({
    onSuccess: ({ id, report }) => {
      setSelectedId(id);
      setEmptyReport(id ? null : report);
      setGenerationRequestId(null);
      return utils.planningProposals.list.invalidate({ date });
    },
  });
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
  const replan = trpc.planningProposals.replan.useMutation({
    onSuccess: ({ id }) => {
      setSelectedId(id);
      return utils.planningProposals.list.invalidate({ date });
    },
  });
  const accept = trpc.planningProposals.accept.useMutation({ onSuccess: refresh });
  const discard = trpc.planningProposals.discard.useMutation({ onSuccess: refresh });
  const error =
    context.error ??
    list.error ??
    proposal.error ??
    create.error ??
    accept.error ??
    discard.error ??
    generate.error ??
    replan.error;
  const ready = context.isFetchedAfterMount && !context.error ? context.data : undefined;
  const current = !proposal.error ? proposal.data : undefined;
  const [clock, setClock] = useState(() => Date.now());
  const reviewBy =
    current?.status === 'PENDING'
      ? (current.preview.replan?.reviewBy ?? current.preview.generation?.reviewBy)
      : undefined;
  useEffect(() => {
    if (!reviewBy) {
      return;
    }
    setClock(Date.now());
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [reviewBy]);
  const reviewExpired = Boolean(reviewBy && new Date(reviewBy).getTime() < clock);
  const invalidReason =
    current?.invalidReason ??
    (reviewExpired ? 'This preview’s start time has passed. Generate a fresh preview.' : null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewId = current?.id;
  useEffect(() => {
    if (previewId) {
      previewRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [previewId]);
  const busy =
    create.isPending ||
    accept.isPending ||
    discard.isPending ||
    generate.isPending ||
    replan.isPending;
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
      {!previewOnly && (
        <>
          <Text size="sm">
            Propose a change, review the result, then apply it. Creating or discarding a proposal
            leaves your plan unchanged.
          </Text>
          <Text size="sm" c="dimmed">
            Times use {timezone}. Historical and calendar blocks are protected. Use progress actions
            to adjust started work.
          </Text>
          <Select
            label="Planning method"
            value={mode}
            data={[
              { value: 'ai', label: 'AI task selection' },
              { value: 'deterministic', label: 'Deterministic · urgency order' },
            ]}
            disabled={busy}
            onChange={(value) => {
              setMode(value as 'ai' | 'deterministic');
              setGenerationRequestId(null);
              generate.reset();
            }}
          />
          <Textarea
            label="Planning guidance"
            placeholder="Focus on housework, or keep today light…"
            description="Without guidance, fill eligible open time. Guidance can narrow the focus or request a lighter day. Existing commitments stay in place."
            value={guidance}
            maxLength={2000}
            disabled={busy || mode === 'deterministic'}
            onChange={(event) => {
              setGuidance(event.currentTarget.value);
              setGenerationRequestId(null);
              generate.reset();
            }}
          />
          <Button
            loading={generate.isPending}
            disabled={busy}
            onClick={() => {
              const id = generationRequestId ?? crypto.randomUUID();
              setGenerationRequestId(id);
              setEmptyReport(null);
              generate.mutate({
                date,
                requestId: id,
                mode,
                guidance: mode === 'ai' ? guidance : '',
              });
            }}
          >
            Generate plan preview
          </Button>
          {generate.isPending && (
            <Text size="sm" role="status">
              Choosing tasks and calculating placements. You can review the saved proposal when
              generation finishes.
            </Text>
          )}
          {emptyReport && (
            <>
              <Text>No plan changes were needed or could fit.</Text>
              <GenerationReview report={emptyReport} timezone={timezone} />
            </>
          )}
        </>
      )}
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
              generate.reset();
              replan.reset();
              void refresh();
            }}
          >
            Refresh planning data
          </Button>
        </Alert>
      )}
      {!previewOnly && (
        <>
          <Accordion defaultValue={manualInitiallyOpen ? 'progress' : null}>
            <Accordion.Item value="review">
              <Accordion.Control>Review day plan</Accordion.Control>
              <Accordion.Panel>
                <PlanReview
                  key={`${date}:${selectedId ?? 'current'}`}
                  date={date}
                  proposalId={current?.status === 'PENDING' ? current.id : undefined}
                  onCreated={setSelectedId}
                />
              </Accordion.Panel>
            </Accordion.Item>
            <Accordion.Item value="progress">
              <Accordion.Control>Progress and remaining day</Accordion.Control>
              <Accordion.Panel>
                <ReplanningControls
                  key={`${date}:${ready?.baseHash}`}
                  date={date}
                  context={ready}
                  preset={preset}
                  savedId={replan.data?.id}
                  busy={busy}
                  submit={(input) => replan.mutate(input)}
                />
              </Accordion.Panel>
            </Accordion.Item>
            <Accordion.Item value="manual">
              <Accordion.Control>Manual plan change</Accordion.Control>
              <Accordion.Panel>
                <Stack>
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
                          data={
                            ready?.candidates.map((c) => ({ value: c.id, label: c.title })) ?? []
                          }
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
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
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
        </>
      )}
      {proposal.isFetching && selectedId && (
        <Text size="sm" role="status">
          Checking proposal…
        </Text>
      )}
      {current && (
        <Stack ref={previewRef}>
          <Badge variant="light">{current.status}</Badge>
          {current.status === 'PENDING' && !invalidReason && (
            <Button variant="light" size="xs" onClick={() => showPreview({ id: current.id, date })}>
              Show preview in calendar
            </Button>
          )}
          {current.preview.taskLimits?.map((limit) => (
            <Text key={limit.taskId} size="sm">
              {limit.title}: at most {limit.maxMinutes} minutes of planned work after{' '}
              {format(limit.startsAt)}. Recorded task effort is unchanged.
            </Text>
          ))}
          {current.preview.freeIntervals?.map((interval) => (
            <Paper withBorder p="sm" key={interval.startsAt}>
              <Text fw={600}>
                Keep free · {format(interval.startsAt)}–{format(interval.endsAt)}
              </Text>
              <Text size="sm">{interval.explanation}</Text>
              <Text size="xs" c="dimmed">
                Enforced for this proposal and its revisions. Future independent planning uses your
                saved availability.
              </Text>
            </Paper>
          ))}
          {current.preview.generation && (
            <GenerationReview
              report={current.preview.generation}
              timezone={current.timezone}
              pending={current.status === 'PENDING'}
            />
          )}
          {current.preview.reservations?.map((reservation) => (
            <Paper withBorder p="sm" key={reservation.startsAt}>
              <Text fw={600}>
                Reserve leisure · {format(reservation.startsAt)}–{format(reservation.endsAt)}
              </Text>
              <Text size="sm">{reservation.explanation}</Text>
            </Paper>
          ))}
          {invalidReason && (
            <Alert color="yellow">
              <Text>{invalidReason}</Text>
              {current.preview.generation && (
                <Button
                  variant="subtle"
                  disabled={busy}
                  onClick={() => {
                    const report = current.preview.generation!;
                    setMode(report.mode);
                    setGuidance(report.guidance);
                    setEmptyReport(null);
                    const requestId = crypto.randomUUID();
                    setGenerationRequestId(requestId);
                    generate.mutate({
                      date,
                      requestId,
                      mode: report.mode,
                      guidance: report.guidance,
                    });
                  }}
                >
                  Generate fresh preview
                </Button>
              )}
            </Alert>
          )}
          {current.preview.replan?.reviewBy && (
            <Text size="sm">
              Apply remaining-day changes before {format(current.preview.replan.reviewBy)} (
              {current.timezone}).
            </Text>
          )}
          {current.preview.taskChanges?.map((change, index) => (
            <Text size="sm" fw={600} key={index}>
              {change.title}:{' '}
              {change.complete
                ? 'explicitly complete task or occurrence'
                : `change total estimate to ${change.estimatedMinutes} minutes`}
            </Text>
          ))}
          {current.preview.replan?.warnings.map((warning) => (
            <Alert key={warning} color="yellow">
              {warning}
            </Alert>
          ))}
          {current.preview.warnings.map((warning) => (
            <Alert key={warning} color="yellow">
              {warning}
            </Alert>
          ))}
          {current.preview.changes.map((change, index) => (
            <Paper key={index} withBorder p="sm">
              <Stack gap="xs">
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => {
                    const block = change.after ?? change.before;
                    showPreview({ id: current.id, date });
                    focus(block?.id ?? null, block?.taskId);
                  }}
                >
                  Highlight task / block
                </Button>
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
                    {change.after.status ? ` · ${change.after.status}` : ''}
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
              {onRevise && (
                <Button
                  variant="light"
                  disabled={busy || Boolean(invalidReason)}
                  onClick={onRevise}
                >
                  Revise in chat
                </Button>
              )}
              <Button
                disabled={Boolean(invalidReason) || busy || proposal.isFetching}
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

function GenerationReview({
  report,
  timezone,
  pending = false,
}: {
  report: GenerationReport;
  timezone: string;
  pending?: boolean;
}) {
  return (
    <Stack gap="xs">
      <Text fw={600}>{report.summary}</Text>
      {report.planningGoal && (
        <Text size="sm">
          Planning goal:{' '}
          {report.planningGoal === 'fill'
            ? 'Fill eligible available time'
            : 'Follow planning guidance'}
          {report.workBudgetMinutes != null
            ? ` · Work budget: ${report.workBudgetMinutes} min`
            : ''}
        </Text>
      )}
      {report.availableWindows && (
        <Stack gap={0}>
          <Text size="sm" fw={600}>
            Availability windows ({timezone})
          </Text>
          {report.availableWindows.map((window) => (
            <Text size="sm" key={window.startsAt}>
              {new Intl.DateTimeFormat(undefined, {
                timeZone: timezone,
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
              }).format(new Date(window.startsAt))}
              –
              {new Intl.DateTimeFormat(undefined, {
                timeZone: timezone,
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
              }).format(new Date(window.endsAt))}
            </Text>
          ))}
          {!report.availableWindows.length && (
            <Text size="sm">No future availability for this date.</Text>
          )}
        </Stack>
      )}
      {Boolean(report.additionalCandidateCount) && (
        <Text size="sm">
          {report.additionalCandidateCount} additional eligible candidates considered after the AI
          shortlist, in urgency order.
        </Text>
      )}
      {pending && report.reviewBy && (
        <Text size="sm">
          Apply before{' '}
          {new Intl.DateTimeFormat(undefined, {
            timeZone: timezone,
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }).format(new Date(report.reviewBy))}{' '}
          ({timezone}). New previews leave at least 10 minutes for review; changes to planning
          inputs can require regeneration sooner.
        </Text>
      )}
      <Text size="sm" c="dimmed">
        {report.model
          ? `AI · ${report.model.provider} / ${report.model.modelId}`
          : report.mode === 'ai'
            ? 'AI planning · no model call needed'
            : 'Deterministic planning'}
      </Text>
      {report.guidance && <Text size="sm">Guidance: {report.guidance}</Text>}
      {report.meals && report.meals.length > 0 && (
        <Stack gap="xs">
          <Text fw={600}>Daily meals</Text>
          {report.meals.map((meal) => (
            <Text key={meal.mealKind} size="sm" c={meal.status === 'unmet' ? 'orange' : undefined}>
              {meal.reason}
            </Text>
          ))}
        </Stack>
      )}
      {report.diagnostics && (
        <Text size="xs" c="dimmed">
          Planning took {(report.diagnostics.elapsedMs / 1000).toFixed(1)} s ·{' '}
          {report.diagnostics.candidateCount} eligible occurrences ·{' '}
          {report.diagnostics.operationCount} changes
        </Text>
      )}
      {report.warnings.map((warning, index) => (
        <Alert color="yellow" key={index}>
          {warning}
        </Alert>
      ))}
      {report.outcomes
        .filter((outcome) => outcome.scheduledMinutes > 0 || outcome.deadlineRisk)
        .map((outcome) => (
          <Paper withBorder p="sm" key={outcome.key}>
            <Text fw={600}>
              {outcome.title}
              {outcome.deadlineRisk ? ' · Deadline at risk' : ''}
            </Text>
            <Text size="sm">
              {outcome.scheduledMinutes} min planned · {outcome.remainingMinutes} min remain
            </Text>
            <Text size="sm" c="dimmed">
              {outcome.reason}
            </Text>
          </Paper>
        ))}
      {report.outcomes.some(
        (outcome) => outcome.scheduledMinutes === 0 && !outcome.deadlineRisk
      ) && (
        <Accordion>
          <Accordion.Item value="omissions">
            <Accordion.Control>
              Other unscheduled tasks (
              {
                report.outcomes.filter(
                  (outcome) => outcome.scheduledMinutes === 0 && !outcome.deadlineRisk
                ).length
              }
              )
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                {report.outcomes
                  .filter((outcome) => outcome.scheduledMinutes === 0 && !outcome.deadlineRisk)
                  .map((outcome) => (
                    <Text key={outcome.key} size="sm">
                      {outcome.title}: {outcome.reason} · {outcome.remainingMinutes} min remain
                    </Text>
                  ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
      {report.selectionSummary && (
        <Accordion>
          <Accordion.Item value="assessment">
            <Accordion.Control>AI assessment before scheduling</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                <Text size="sm">{report.selectionSummary}</Text>
                {report.outcomes
                  .filter((outcome) => outcome.selectionReason)
                  .map((outcome) => (
                    <Text size="sm" key={outcome.key}>
                      {outcome.title}: {outcome.selectionReason}
                    </Text>
                  ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
    </Stack>
  );
}
