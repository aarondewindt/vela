'use client';

import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Collapse,
  Group,
  Modal,
  Paper,
  Select,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { AgendaView, DayView, type ScheduleEventData } from '@mantine/schedule';
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconList,
  IconPlus,
  IconSparkles,
  IconTargetArrow,
} from '@tabler/icons-react';
import {
  useApplyStandardAvailabilityMutation,
  useCreateManualBlockMutation,
  useDayDataQuery,
  useGenerateDraftMutation,
  useTasksQuery,
  useUpdateBlockOutcomeMutation,
  useUpdateBlockTimeMutation,
} from '@/lib/planner/query';
import { usePlannerStore } from '@/lib/planner/store';
import { taskStatusLabels } from '@/lib/planner/tasks';
import classes from './TodayView.module.css';

type PlannerMode = 'day' | 'agenda';

function dateFromPicker(value: Date | null) {
  if (!value) return null;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDate(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function localDateTime(value: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(value)
      .map(({ type, value: part }) => [type, part])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatTime(value: Date | string, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).format(new Date(value));
}

function formatSelectedDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Select a date';
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return 'Select a date';
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function currentDateInTimezone(timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date())
      .map(({ type, value }) => [type, value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localMinuteToInstant(date: string, minute: number, timezone: string) {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1, day, 0, minute));
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  let instant = target.getTime();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, value])
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute)
    );
    const correction = target.getTime() - represented;
    if (correction === 0) return new Date(instant);
    instant += correction;
  }
  return new Date(target);
}

function getNextFreeTime(
  date: string,
  taskMinutes: number,
  timezone: string,
  availability: { start: Date; end: Date }[],
  events: { startsAt: Date; endsAt: Date; isBusy: boolean }[],
  blocks: { startsAt: Date; endsAt: Date; status: string }[]
) {
  const fallbackStart = localMinuteToInstant(date, 8 * 60, timezone);
  const windows = availability.length
    ? availability
    : [{ start: fallbackStart, end: localMinuteToInstant(date, 23 * 60, timezone) }];
  const occupied = [
    ...events.filter((event) => event.isBusy).map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
    ...blocks
      .filter((block) => !['CANCELED', 'SKIPPED'].includes(block.status))
      .map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
  ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const now = new Date(Math.ceil(Date.now() / 900_000) * 900_000);
  for (const window of windows) {
    let cursor = new Date(window.start);
    if (date === currentDateInTimezone(timezone) && now > cursor) {
      cursor = now;
    }
    for (const busy of occupied) {
      const endWithGap = new Date(busy.endsAt.getTime() + 15 * 60_000);
      if (endWithGap <= cursor || busy.startsAt >= window.end) continue;
      if (busy.startsAt.getTime() - cursor.getTime() >= taskMinutes * 60_000) break;
      if (busy.startsAt <= cursor) cursor = endWithGap;
    }
    if (cursor.getTime() + taskMinutes * 60_000 <= window.end.getTime()) {
      return localDateTime(cursor, timezone);
    }
  }
  return null;
}

export function TodayView() {
  const selectedDate = usePlannerStore((state) => state.selectedDate);
  const setSelectedDate = usePlannerStore((state) => state.setSelectedDate);
  const dayQuery = useDayDataQuery(selectedDate);
  const tasksQuery = useTasksQuery();
  const generateDraft = useGenerateDraftMutation();
  const applyStandardAvailability = useApplyStandardAvailabilityMutation();
  const createBlock = useCreateManualBlockMutation();
  const updateBlockTime = useUpdateBlockTimeMutation();
  const updateOutcome = useUpdateBlockOutcomeMutation();

  const [mode, setMode] = useState<PlannerMode>('day');
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [startAt, setStartAt] = useState('09:00');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  const dayData = dayQuery.data;
  const plan = dayData?.plan;
  const timezone = dayData?.timezone ?? 'Europe/Amsterdam';
  const blocks = plan?.dailyBlocks ?? [];
  const tasks = tasksQuery.data ?? [];
  const scheduledTaskIds = new Set(
    blocks.flatMap((block) => (block.taskOccurrence?.taskId ? [block.taskOccurrence.taskId] : []))
  );
  const backlog = tasks.filter(
    (task) =>
      !['DONE', 'ARCHIVED', 'PAUSED'].includes(task.status) && !scheduledTaskIds.has(task.id)
  );
  const selectedBlock = blocks.find((block) => block.id === selectedBlockId) ?? null;
  const hasAvailability = (dayData?.availability.length ?? 0) > 0;
  const busyEvents = (dayData?.events ?? []).filter((event) => event.isBusy);

  const scheduleEvents = useMemo<ScheduleEventData[]>(() => {
    const blockEvents = (dayData?.plan?.dailyBlocks ?? []).map((block) => ({
      id: block.id,
      title: block.title,
      start: localDateTime(block.startsAt, timezone),
      end: localDateTime(block.endsAt, timezone),
      color:
        block.status === 'DONE'
          ? 'green'
          : block.status === 'SKIPPED' || block.status === 'CANCELED'
            ? 'gray'
            : block.status === 'IN_PROGRESS'
              ? 'orange'
              : 'teal',
      variant: 'light' as const,
      payload: { kind: 'block', blockId: block.id, status: block.status },
    }));
    const calendarEvents = (dayData?.events ?? []).map((event) => ({
      id: `calendar-${event.id}`,
      title: event.title,
      start: localDateTime(event.startsAt, timezone),
      end: localDateTime(event.endsAt, timezone),
      color: event.isBusy ? 'red' : 'gray',
      variant: 'light' as const,
      display: event.isBusy ? ('background' as const) : ('default' as const),
      payload: { kind: 'calendar', isBusy: event.isBusy },
    }));
    return [...blockEvents, ...calendarEvents];
  }, [dayData?.events, dayData?.plan?.dailyBlocks, timezone]);

  const error =
    dayQuery.error ??
    tasksQuery.error ??
    generateDraft.error ??
    applyStandardAvailability.error ??
    createBlock.error ??
    updateBlockTime.error ??
    updateOutcome.error;

  const openAddTask = (time?: string) => {
    setSelectedTaskId(null);
    setStartAt(time ?? '09:00');
    setAddTaskOpen(true);
  };

  const addTaskAt = (taskId: string, startsAt: string) => {
    createBlock.mutate(
      { date: selectedDate, taskId, startsAt },
      {
        onSuccess: () => {
          setAddTaskOpen(false);
          setSelectedTaskId(null);
        },
      }
    );
  };

  const addToNextSlot = (task: (typeof tasks)[number]) => {
    const startsAt = getNextFreeTime(
      selectedDate,
      task.estimatedMinutes && task.estimatedMinutes > 0 ? task.estimatedMinutes : 25,
      timezone,
      dayData?.availability ?? [],
      dayData?.events ?? [],
      blocks
    );
    if (!startsAt) {
      setBacklogOpen(true);
      return;
    }
    addTaskAt(task.id, startsAt);
  };

  const updateScheduleTime = (eventId: string | number, newStart: string, newEnd: string) => {
    const event = scheduleEvents.find((item) => item.id === eventId);
    if (!event || event.payload?.kind !== 'block') return;
    updateBlockTime.mutate({
      date: selectedDate,
      blockId: String(event.payload.blockId),
      startsAt: newStart,
      endsAt: newEnd,
    });
  };

  if (dayQuery.isPending || tasksQuery.isPending) {
    return <div className={classes.loading}>Loading your day...</div>;
  }

  return (
    <Stack gap="md" className={classes.root}>
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <div>
          <Text c="teal.4" size="xs" fw={700} tt="uppercase">
            Planning / Today
          </Text>
          <Title order={2}>{formatSelectedDate(selectedDate)}</Title>
          <Text c="dimmed" size="sm">
            {blocks.filter((block) => block.status === 'DONE').length} of {blocks.length} planned
            blocks complete
          </Text>
        </div>
        <Group gap="xs" align="center">
          <Tooltip label="Previous day">
            <ActionIcon
              aria-label="Previous day"
              variant="default"
              onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
            >
              <IconChevronLeft size={16} />
            </ActionIcon>
          </Tooltip>
          <DatePickerInput
            aria-label="Planning date"
            value={selectedDate}
            onChange={(value) => {
              if (value) setSelectedDate(value);
            }}
            valueFormat="ddd, MMM D"
            size="sm"
            w={150}
            leftSection={<IconCalendar size={15} />}
            leftSectionPointerEvents="none"
          />
          <Tooltip label="Next day">
            <ActionIcon
              aria-label="Next day"
              variant="default"
              onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}
            >
              <IconChevronRight size={16} />
            </ActionIcon>
          </Tooltip>
          <Button
            size="xs"
            variant="default"
            onClick={() => setSelectedDate(currentDateInTimezone(timezone))}
          >
            Today
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert color="red" title="Planner action failed" withCloseButton>
          {error.message}
        </Alert>
      )}

      {!hasAvailability && (
        <Alert
          color="yellow"
          title="No availability set for this day"
          icon={<IconTargetArrow size={17} />}
          className={classes.availabilityAlert}
        >
          <Group justify="space-between" align="center" wrap="wrap">
            <Text size="sm">
              You can still add tasks manually. Set standard hours to enable automatic draft
              planning.
            </Text>
            <Button size="xs" variant="light" onClick={() => setAvailabilityOpen(true)}>
              Set standard hours
            </Button>
          </Group>
        </Alert>
      )}

      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <SegmentedControl
          value={mode}
          onChange={(value) => setMode(value as PlannerMode)}
          data={[
            {
              label: (
                <Group gap={6} wrap="nowrap">
                  <IconCalendar size={14} />
                  Day
                </Group>
              ),
              value: 'day',
            },
            {
              label: (
                <Group gap={6} wrap="nowrap">
                  <IconList size={14} />
                  Agenda
                </Group>
              ),
              value: 'agenda',
            },
          ]}
          size="xs"
        />
        <Group gap="xs">
          <Button
            size="xs"
            variant="default"
            leftSection={<IconPlus size={14} />}
            onClick={() => {
              setBacklogOpen((open) => !open);
              if (!backlogOpen) setSelectedTaskId(null);
            }}
          >
            Add task
          </Button>
          <Button
            size="xs"
            leftSection={<IconSparkles size={14} />}
            loading={generateDraft.isPending}
            disabled={!hasAvailability}
            onClick={() => generateDraft.mutate({ date: selectedDate })}
          >
            Generate draft
          </Button>
        </Group>
      </Group>

      <Collapse expanded={backlogOpen}>
        <Paper withBorder p="sm" radius="sm" className={classes.backlog}>
          <Group justify="space-between" mb="xs">
            <Text fw={600} size="sm">
              Available tasks
            </Text>
            <Badge variant="light" color="gray">
              {backlog.length}
            </Badge>
          </Group>
          {backlog.length === 0 ? (
            <Text size="sm" c="dimmed">
              No open tasks are available to add.
            </Text>
          ) : (
            <Stack gap={4}>
              {backlog.map((task) => (
                <Group
                  key={task.id}
                  justify="space-between"
                  wrap="nowrap"
                  className={classes.backlogRow}
                >
                  <div className={classes.taskSummary}>
                    <Text size="sm" fw={500} lineClamp={1}>
                      {task.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      P{task.priority} · {task.estimatedMinutes ?? 25} min ·{' '}
                      {taskStatusLabels[task.status]}
                    </Text>
                  </div>
                  <Tooltip label="Add to the next available slot">
                    <ActionIcon
                      aria-label={`Add ${task.title} to the plan`}
                      variant="subtle"
                      color="teal"
                      loading={createBlock.isPending && createBlock.variables?.taskId === task.id}
                      onClick={() => addToNextSlot(task)}
                    >
                      <IconPlus size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              ))}
            </Stack>
          )}
        </Paper>
      </Collapse>

      <Paper radius="sm" className={classes.scheduleSurface}>
        {mode === 'day' ? (
          <DayView
            date={selectedDate}
            onDateChange={setSelectedDate}
            events={scheduleEvents}
            classNames={{ dayViewSlot: classes.dayViewSlot }}
            getTimeSlotProps={({ start, end }) => {
              const isAvailable = dayData?.availability.some((window) => {
                const windowStart = localDateTime(window.start, timezone);
                const windowEnd = localDateTime(window.end, timezone);
                return start >= windowStart && end <= windowEnd;
              });
              return isAvailable ? { 'data-available': true } : undefined;
            }}
            startTime="06:00:00"
            // endTime="23:59:00"
            intervalMinutes={15}
            slotHeight={48}
            withHeader={false}
            // startScrollTime="08:00:00"
            startScrollTime={
              dayData?.availability[0]
                ? `${formatTime(dayData.availability[0].start, timezone)}:00`
                : '08:00:00'
            }
            withCurrentTimeIndicator
            withEventsDragAndDrop
            withEventResize
            eventDragInterval={15}
            eventResizeInterval={15}
            canDragEvent={(event) =>
              event.payload?.kind === 'block' && event.payload?.status === 'PLANNED'
            }
            canResizeEvent={(event) =>
              event.payload?.kind === 'block' && event.payload?.status === 'PLANNED'
            }
            onTimeSlotClick={({ slotStart }) => {
              const [, time] = slotStart.split(' ');
              openAddTask(time?.slice(0, 5));
            }}
            onEventClick={(event) => {
              if (event.payload?.kind === 'block')
                setSelectedBlockId(String(event.payload.blockId));
            }}
            onEventDrop={({ eventId, newStart, newEnd }) =>
              updateScheduleTime(eventId, newStart, newEnd)
            }
            onEventResize={({ eventId, newStart, newEnd }) =>
              updateScheduleTime(eventId, newStart, newEnd)
            }
            preventEventOverlap={(stillEvent, movingEvent) => {
              if (
                stillEvent.payload?.kind === 'availability' ||
                movingEvent.payload?.kind === 'availability'
              ) {
                return false;
              }
              const stillIsBlock = stillEvent.payload?.kind === 'block';
              const movingIsBlock = movingEvent.payload?.kind === 'block';
              return (
                (stillIsBlock && (movingIsBlock || movingEvent.payload?.isBusy)) ||
                (movingIsBlock && (stillIsBlock || stillEvent.payload?.isBusy))
              );
            }}
            withAllDaySlot={false}
          />
        ) : (
          <AgendaView
            rangeStart={selectedDate}
            rangeEnd={selectedDate}
            events={scheduleEvents}
            onEventClick={(event) => {
              if (event.payload?.kind === 'block')
                setSelectedBlockId(String(event.payload.blockId));
            }}
          />
        )}
      </Paper>

      <Group justify="space-between" c="dimmed" className={classes.footer}>
        <Text size="xs">{timezone}</Text>
        <Text size="xs">
          {busyEvents.length} busy calendar {busyEvents.length === 1 ? 'event' : 'events'}
        </Text>
      </Group>

      <Modal
        opened={availabilityOpen}
        onClose={() => setAvailabilityOpen(false)}
        title="Apply standard availability"
        centered
        size="sm"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Weekdays use 18:30–22:30 and weekends use 10:00–18:00. Applying every week replaces your
            current weekly availability.
          </Text>
          <Button
            variant="default"
            loading={applyStandardAvailability.isPending}
            onClick={() =>
              applyStandardAvailability.mutate(
                { date: selectedDate, scope: 'date' },
                { onSuccess: () => setAvailabilityOpen(false) }
              )
            }
          >
            This day only
          </Button>
          <Button
            loading={applyStandardAvailability.isPending}
            onClick={() =>
              applyStandardAvailability.mutate(
                { date: selectedDate, scope: 'recurring' },
                { onSuccess: () => setAvailabilityOpen(false) }
              )
            }
          >
            Every week
          </Button>
        </Stack>
      </Modal>

      <Modal
        opened={addTaskOpen}
        onClose={() => setAddTaskOpen(false)}
        title="Add a task to this day"
        centered
        size="sm"
      >
        <Stack>
          <Select
            label="Task"
            placeholder="Choose an open task"
            searchable
            data={backlog.map((task) => ({ value: task.id, label: task.title }))}
            value={selectedTaskId}
            onChange={setSelectedTaskId}
          />
          <Select
            label="Start time"
            data={Array.from({ length: 68 }, (_, index) => {
              const total = 6 * 60 + index * 15;
              const hour = String(Math.floor(total / 60)).padStart(2, '0');
              const minute = String(total % 60).padStart(2, '0');
              return { value: `${hour}:${minute}`, label: `${hour}:${minute}` };
            })}
            value={startAt}
            onChange={(value) => value && setStartAt(value)}
            searchable
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setAddTaskOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={createBlock.isPending}
              disabled={!selectedTaskId}
              onClick={() =>
                selectedTaskId && addTaskAt(selectedTaskId, `${selectedDate} ${startAt}:00`)
              }
            >
              Add to plan
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(selectedBlock)}
        onClose={() => setSelectedBlockId(null)}
        title={selectedBlock?.title ?? 'Planned task'}
        centered
        size="sm"
      >
        {selectedBlock && (
          <Stack>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                {formatTime(selectedBlock.startsAt, timezone)}–
                {formatTime(selectedBlock.endsAt, timezone)}
              </Text>
              <Badge color={selectedBlock.status === 'DONE' ? 'green' : 'teal'} variant="light">
                {selectedBlock.status.toLowerCase().replace('_', ' ')}
              </Badge>
            </Group>
            {selectedBlock.brief && <Text size="sm">{selectedBlock.brief}</Text>}
            <Group justify="flex-end">
              <Button
                variant="default"
                color="gray"
                disabled={selectedBlock.status === 'DONE' || selectedBlock.status === 'SKIPPED'}
                loading={updateOutcome.isPending}
                onClick={() =>
                  updateOutcome.mutate(
                    { date: selectedDate, blockId: selectedBlock.id, outcome: 'SKIPPED' },
                    { onSuccess: () => setSelectedBlockId(null) }
                  )
                }
              >
                Skip
              </Button>
              <Button
                disabled={selectedBlock.status === 'DONE' || selectedBlock.status === 'SKIPPED'}
                loading={updateOutcome.isPending}
                onClick={() =>
                  updateOutcome.mutate(
                    { date: selectedDate, blockId: selectedBlock.id, outcome: 'DONE' },
                    { onSuccess: () => setSelectedBlockId(null) }
                  )
                }
              >
                Mark done
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
