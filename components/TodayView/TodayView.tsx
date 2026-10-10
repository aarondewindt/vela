'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Collapse,
  ColorSwatch,
  Group,
  HoverCard,
  Modal,
  NumberInput,
  Paper,
  Portal,
  Select,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { DayView, type ScheduleEventData } from '@mantine/schedule';
import {
  IconCalendar,
  IconCheck,
  IconCircleCheck,
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
  IconPlayerSkipForward,
  IconRotateClockwise,
  IconSparkles,
  IconTargetArrow,
  IconTrash,
} from '@tabler/icons-react';
import {
  useApplyStandardAvailabilityMutation,
  useAcceptDraftMutation,
  useClearDayPlanMutation,
  useCreateManualBlockMutation,
  useCreateManualCategoryBlockMutation,
  useRemoveCategorySlotMutation,
  useDayDataQuery,
  useGenerateDraftMutation,
  useGeneratorSettingsQuery,
  useRemoveBlockFromDayMutation,
  useTasksQuery,
  useThemesQuery,
  useUnskipBlockMutation,
  useUpdateBlockOutcomeMutation,
  useUpdateBlockTimeMutation,
  useSaveGeneratorSettingsMutation,
} from '@/lib/planner/query';
import { usePlannerStore } from '@/lib/planner/store';
import {
  planningCategories,
  planningCategoryLabels,
  taskStatusLabels,
} from '@/lib/planner/tasks';
import { DEFAULT_GENERATOR_OPTIONS, type GeneratorOptions } from '@/lib/planner/scheduling';
import { useAppShellStore } from '@/store/app_shell_store';
import { Property, PropertyPanel, ReadOnlyValue } from '../DataView/PropertyPanel';
import { TaskView } from '../TasksView/TaskView';
import classes from './TodayView.module.css';

const swatchColor = (color: string) =>
  color.startsWith('#') || color.includes('(') ? color : `var(--mantine-color-${color}-6)`;
const categoryColors: Record<string, string> = {
  WORK: 'blue',
  LIFE: 'orange',
  LEISURE: 'green',
  REST: 'cyan',
};
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
  const setAsideOpened = useAppShellStore((state) => state.set_aside_opened);
  const dayQuery = useDayDataQuery(selectedDate);
  const tasksQuery = useTasksQuery();
  const themesQuery = useThemesQuery();
  const generateDraft = useGenerateDraftMutation();
  const generatorSettingsQuery = useGeneratorSettingsQuery();
  const saveGeneratorSettings = useSaveGeneratorSettingsMutation();
  const acceptDraft = useAcceptDraftMutation();
  const clearDayPlan = useClearDayPlanMutation();
  const applyStandardAvailability = useApplyStandardAvailabilityMutation();
  const createBlock = useCreateManualBlockMutation();
  const createCategoryBlock = useCreateManualCategoryBlockMutation();
  const removeCategorySlot = useRemoveCategorySlotMutation();
  const updateBlockTime = useUpdateBlockTimeMutation();
  const updateOutcome = useUpdateBlockOutcomeMutation();
  const removeBlock = useRemoveBlockFromDayMutation();
  const unskipBlock = useUnskipBlockMutation();

  const [colorBy, setColorBy] = useState<'theme' | 'category'>('theme');
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [addCategoryBlockOpen, setAddCategoryBlockOpen] = useState(false);
  const [categoryBlockCategory, setCategoryBlockCategory] = useState<string>('LEISURE');
  const [categoryBlockStart, setCategoryBlockStart] = useState('09:00');
  const [categoryBlockEnd, setCategoryBlockEnd] = useState('10:00');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [startAt, setStartAt] = useState('09:00');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedCategorySlotId, setSelectedCategorySlotId] = useState<string | null>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [clearPlanOpen, setClearPlanOpen] = useState(false);
  const [generatorDraft, setGeneratorDraft] = useState<GeneratorOptions>(DEFAULT_GENERATOR_OPTIONS);

  useEffect(() => {
    if (generatorSettingsQuery.data) {
      setGeneratorDraft(generatorSettingsQuery.data);
    }
  }, [generatorSettingsQuery.data]);

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
  const categorySlots = plan?.categorySlots ?? [];
  const selectedCategorySlot = categorySlots.find((slot) => slot.id === selectedCategorySlotId) ?? null;
  const selectedTask = selectedBlock?.taskOccurrence?.taskId
    ? tasks.find((task) => task.id === selectedBlock.taskOccurrence?.taskId)
    : undefined;
  const hasAvailability = (dayData?.availability.length ?? 0) > 0;
  const generatorDraftError =
    generatorDraft.workSessionMinutes < 15 ||
    generatorDraft.workSessionMinutes > 240 ||
    generatorDraft.workSessionMinutes % 15 !== 0 ||
    generatorDraft.shortBreakMinutes < 5 ||
    generatorDraft.shortBreakMinutes > 60 ||
    generatorDraft.shortBreakMinutes % 5 !== 0 ||
    generatorDraft.leisureMinutes < 0 ||
    generatorDraft.leisureMinutes > 240 ||
    generatorDraft.leisureMinutes % 15 !== 0 ||
    generatorDraft.shortLeisureBlockMinutes < 15 ||
    generatorDraft.shortLeisureBlockMinutes > 120 ||
    generatorDraft.shortLeisureBlockMinutes % 15 !== 0 ||
    generatorDraft.maxLeisureBlockMinutes < generatorDraft.shortLeisureBlockMinutes ||
    generatorDraft.maxLeisureBlockMinutes > 240 ||
    generatorDraft.maxLeisureBlockMinutes % 15 !== 0;
  const busyEvents = (dayData?.events ?? []).filter((event) => event.isBusy);
  const legendItems =
    colorBy === 'category'
      ? planningCategories.map((value) => ({
          label: planningCategoryLabels[value],
          color: categoryColors[value],
        }))
      : [
          ...(themesQuery.data ?? []).map((theme) => ({
            label: theme.name,
            color: theme.color ?? 'gray',
          })),
          { label: 'No theme', color: 'gray' },
        ];

  useEffect(() => setAsideOpened(Boolean(selectedBlock)), [selectedBlock, setAsideOpened]);

  const scheduleEvents = useMemo<ScheduleEventData[]>(() => {
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const themesById = new Map((themesQuery.data ?? []).map((theme) => [theme.id, theme]));
    const blockEvents = (dayData?.plan?.dailyBlocks ?? []).map((block) => ({
      id: block.id,
      title: block.title,
      start: localDateTime(block.startsAt, timezone),
      end: localDateTime(block.endsAt, timezone),
      color: block.calendarEventId
        ? block.calendarEvent?.isBusy
          ? 'red'
          : 'gray'
        : colorBy === 'category'
          ? categoryColors[
              block.category ??
                tasksById.get(block.taskOccurrence?.taskId ?? '')?.category ??
                'WORK'
            ] ?? 'gray'
          : (themesById.get(tasksById.get(block.taskOccurrence?.taskId ?? '')?.themeId ?? '')
              ?.color ?? 'gray'),
      variant: 'light' as const,
      display: block.calendarEventId && block.calendarEvent?.isBusy ? ('background' as const) : undefined,
      payload: block.calendarEventId
        ? { kind: 'calendar', isBusy: Boolean(block.calendarEvent?.isBusy) }
        : { kind: 'block', blockId: block.id, status: block.status },
    }));
    const categorySlotEvents = (dayData?.plan?.categorySlots ?? []).map((slot) => ({
      id: `category-slot-${slot.id}`,
      title: planningCategoryLabels[slot.category],
      start: localDateTime(slot.startsAt, timezone),
      end: localDateTime(slot.endsAt, timezone),
      color: categoryColors[slot.category],
      variant: 'light' as const,
      display: 'background' as const,
      payload: { kind: 'category-slot', slotId: slot.id, source: slot.source },
    }));
    const linkedEventIds = new Set(
      (dayData?.plan?.dailyBlocks ?? []).flatMap((block) =>
        block.calendarEventId ? [block.calendarEventId] : []
      )
    );
    const calendarEvents = (dayData?.events ?? []).filter((event) => !linkedEventIds.has(event.id)).map((event) => ({
      id: `calendar-${event.id}`,
      title: event.title,
      start: localDateTime(event.startsAt, timezone),
      end: localDateTime(event.endsAt, timezone),
      color: event.isBusy ? 'red' : 'gray',
      variant: 'light' as const,
      display: event.isBusy ? ('background' as const) : ('default' as const),
      payload: { kind: 'calendar', isBusy: event.isBusy },
    }));
    return [...categorySlotEvents, ...blockEvents, ...calendarEvents];
  }, [colorBy, dayData?.events, dayData?.plan?.categorySlots, dayData?.plan?.dailyBlocks, tasks, themesQuery.data, timezone]);

  const error =
    dayQuery.error ??
    tasksQuery.error ??
    generatorSettingsQuery.error ??
    generateDraft.error ??
    saveGeneratorSettings.error ??
    acceptDraft.error ??
    clearDayPlan.error ??
    applyStandardAvailability.error ??
    createBlock.error ??
    createCategoryBlock.error ??
    removeCategorySlot.error ??
    updateBlockTime.error ??
    updateOutcome.error ??
    removeBlock.error ??
    unskipBlock.error;

  const openAddTask = (time?: string) => {
    setSelectedTaskId(null);
    setStartAt(time ?? '09:00');
    setAddTaskOpen(true);
  };

  const changeSelectedDate = (date: string) => {
    setSelectedDate(date);
  };

  const updateGeneratorDraft = (field: keyof GeneratorOptions, value: number | string) => {
    const parsed = Number(value);
    setGeneratorDraft((current) => ({
      ...current,
      [field]: Number.isFinite(parsed) ? parsed : 0,
    }));
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

  const closeSelectedBlock = () => setSelectedBlockId(null);
  const selectedBlockActions = selectedBlock && (
    <Group gap={4} wrap="nowrap">
      <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
        {formatTime(selectedBlock.startsAt, timezone)}–{formatTime(selectedBlock.endsAt, timezone)}
      </Text>
      <Badge color={selectedBlock.status === 'DONE' ? 'green' : 'teal'} variant="light">
        {selectedBlock.status.toLowerCase().replace('_', ' ')}
      </Badge>
      {selectedBlock.status === 'SKIPPED' ? (
        <Tooltip label="Unskip">
          <ActionIcon
            aria-label="Unskip"
            variant="subtle"
            size="xs"
            loading={unskipBlock.isPending}
            onClick={() =>
              unskipBlock.mutate(
                { date: selectedDate, blockId: selectedBlock.id },
                { onSuccess: closeSelectedBlock }
              )
            }
          >
            <IconRotateClockwise size={16} />
          </ActionIcon>
        </Tooltip>
      ) : (
        <Tooltip label="Skip">
          <ActionIcon
            aria-label="Skip"
            variant="subtle"
            size="xs"
            disabled={selectedBlock.status === 'DONE'}
            loading={updateOutcome.isPending}
            onClick={() =>
              updateOutcome.mutate(
                { date: selectedDate, blockId: selectedBlock.id, outcome: 'SKIPPED' },
                { onSuccess: closeSelectedBlock }
              )
            }
          >
            <IconPlayerSkipForward size={16} />
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip label="Done for now">
        <ActionIcon
          aria-label="Done for now"
          variant="subtle"
          size="xs"
          disabled={selectedBlock.status === 'DONE' || selectedBlock.status === 'SKIPPED'}
          loading={updateOutcome.isPending}
          onClick={() =>
            updateOutcome.mutate(
              { date: selectedDate, blockId: selectedBlock.id, outcome: 'DONE' },
              { onSuccess: closeSelectedBlock }
            )
          }
        >
          <IconCheck size={16} />
        </ActionIcon>
      </Tooltip>
      {selectedBlock.taskOccurrenceId && (
        <Tooltip label="Complete task">
          <ActionIcon
            aria-label="Complete task"
            variant="subtle"
            size="xs"
            disabled={selectedBlock.status === 'DONE' || selectedBlock.status === 'SKIPPED'}
            loading={updateOutcome.isPending}
            onClick={() =>
              updateOutcome.mutate(
                {
                  date: selectedDate,
                  blockId: selectedBlock.id,
                  outcome: 'DONE',
                  completeTask: true,
                },
                { onSuccess: closeSelectedBlock }
              )
            }
          >
            <IconCircleCheck size={16} />
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip label="Remove from day">
        <ActionIcon
          aria-label="Remove from day"
          variant="subtle"
          size="xs"
          color="red"
          disabled={selectedBlock.status !== 'PLANNED' && selectedBlock.status !== 'SKIPPED'}
          loading={removeBlock.isPending}
          onClick={() =>
            removeBlock.mutate(
              { date: selectedDate, blockId: selectedBlock.id },
              { onSuccess: closeSelectedBlock }
            )
          }
        >
          <IconTrash size={16} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
  const selectedBlockInspector = selectedBlock ? (
    selectedTask ? (
      <TaskView
        task={selectedTask}
        themes={themesQuery.data ?? []}
        tagSuggestions={[...new Set(tasks.flatMap((task) => task.tags))].sort()}
        onClose={closeSelectedBlock}
        actions={selectedBlockActions}
      />
    ) : (
      <PropertyPanel
        kind="Plan block"
        id={selectedBlock.id}
        onClose={closeSelectedBlock}
        actions={selectedBlockActions}
      >
        <Title order={3}>{selectedBlock.title}</Title>
        {selectedBlock.brief && <Text size="sm">{selectedBlock.brief}</Text>}
        <Property label="Category">
          <ReadOnlyValue>
            {planningCategoryLabels[selectedBlock.category ?? 'WORK']}
          </ReadOnlyValue>
        </Property>
      </PropertyPanel>
    )
  ) : null;

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
          <Group gap="xs" align="center">
            <Title order={2}>{formatSelectedDate(selectedDate)}</Title>
            <Badge
              color={
                plan?.status === 'DRAFT'
                  ? 'yellow'
                  : plan?.status === 'ACTIVE'
                    ? 'teal'
                    : plan?.status === 'FINALIZED'
                      ? 'green'
                      : 'gray'
              }
              variant="light"
            >
              {plan ? `${plan.status.toLowerCase()} · v${plan.version}` : 'No plan'}
            </Badge>
          </Group>
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
              onClick={() => changeSelectedDate(shiftDate(selectedDate, -1))}
            >
              <IconChevronLeft size={16} />
            </ActionIcon>
          </Tooltip>
          <DatePickerInput
            aria-label="Planning date"
            value={selectedDate}
            onChange={(value) => {
              if (value) changeSelectedDate(value);
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
              onClick={() => changeSelectedDate(shiftDate(selectedDate, 1))}
            >
              <IconChevronRight size={16} />
            </ActionIcon>
          </Tooltip>
          <Button
            size="xs"
            variant="default"
            onClick={() => changeSelectedDate(currentDateInTimezone(timezone))}
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
              You can still add tasks manually. Set standard hours to enable automatic draft planning.
            </Text>
          </Group>
        </Alert>
      )}

      <Group justify="flex-end" align="center" wrap="wrap" gap="sm">
        <Group gap="xs">
          <HoverCard position="bottom-start" withArrow shadow="md" openDelay={150}>
            <HoverCard.Target>
              <div>
                <SegmentedControl
                  size="xs"
                  aria-label="Color blocks by"
                  value={colorBy}
                  onChange={(value) => setColorBy(value as 'theme' | 'category')}
                  data={[
                    { label: 'Color by theme', value: 'theme' },
                    { label: 'Color by category', value: 'category' },
                  ]}
                />
              </div>
            </HoverCard.Target>
            <HoverCard.Dropdown>
              <Stack gap={6}>
                <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                  {colorBy === 'theme' ? 'Themes' : 'Categories'}
                </Text>
                {legendItems.map((item) => (
                  <Group key={item.label} gap="xs" wrap="nowrap">
                    <ColorSwatch size={14} color={swatchColor(item.color)} />
                    <Text size="sm">{item.label}</Text>
                  </Group>
                ))}
              </Stack>
            </HoverCard.Dropdown>
          </HoverCard>
          <Button
            size="xs"
            variant="default"
            onClick={() => setAvailabilityOpen(true)}
          >
            Standard hours
          </Button>
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
            variant="default"
            onClick={() => setAddCategoryBlockOpen(true)}
          >
            Add category block
          </Button>
          <Button
            size="xs"
            leftSection={<IconSparkles size={14} />}
            loading={generateDraft.isPending}
            disabled={!hasAvailability}
            onClick={() => setGeneratorOpen(true)}
          >
            Generate draft
          </Button>
          {plan?.status === 'DRAFT' && (
            <Button
              size="xs"
              color="teal"
              leftSection={<IconCheck size={14} />}
              loading={acceptDraft.isPending}
              onClick={() => acceptDraft.mutate({ date: selectedDate })}
            >
              Accept draft
            </Button>
          )}
          {plan && (
            <Tooltip label="Clear this day's plan">
              <ActionIcon
                aria-label="Clear this day's plan"
                variant="default"
                color="red"
                onClick={() => setClearPlanOpen(true)}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          )}
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
            withHeader
            withAgenda
            withInteractiveBackgroundEvents
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
              if (event.payload?.kind === 'category-slot') {
                setSelectedCategorySlotId(String(event.payload.slotId));
              } else if (event.payload?.kind === 'block') {
                setSelectedBlockId(String(event.payload.blockId));
              }
            }}
            onEventDrop={({ eventId, newStart, newEnd }) =>
              updateScheduleTime(eventId, newStart, newEnd)
            }
            onEventResize={({ eventId, newStart, newEnd }) =>
              updateScheduleTime(eventId, newStart, newEnd)
            }
            preventEventOverlap={(stillEvent, movingEvent) => {
              if (
                stillEvent.payload?.kind === 'category-slot' ||
                movingEvent.payload?.kind === 'category-slot'
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
            Standard hours set weekdays to 08:00–08:45, 12:00–13:00, and 17:15–00:00, and weekends
            to 10:00–00:00. Applying every week replaces your current weekly availability.
          </Text>
          <Button
            variant="default"
            loading={applyStandardAvailability.isPending}
            onClick={() =>
              applyStandardAvailability.mutate(
                { date: selectedDate, scope: 'date' },
                {
                  onSuccess: () => {
                    setAvailabilityOpen(false);
                  },
                }
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
                {
                  onSuccess: () => {
                    setAvailabilityOpen(false);
                  },
                }
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
        opened={generatorOpen}
        onClose={() => setGeneratorOpen(false)}
        title="Generate day plan"
        centered
        size="sm"
      >
        <Stack>
          <NumberInput
            label="Maximum work session"
            suffix=" min"
            min={15}
            max={240}
            step={15}
            allowDecimal={false}
            value={generatorDraft.workSessionMinutes}
            onChange={(value) => updateGeneratorDraft('workSessionMinutes', value)}
          />
          <NumberInput
            label="Short break"
            suffix=" min"
            min={5}
            max={60}
            step={5}
            allowDecimal={false}
            value={generatorDraft.shortBreakMinutes}
            onChange={(value) => updateGeneratorDraft('shortBreakMinutes', value)}
          />
          <NumberInput
            label="Leisure time"
            suffix=" min"
            min={0}
            max={240}
            step={15}
            allowDecimal={false}
            value={generatorDraft.leisureMinutes}
            onChange={(value) => updateGeneratorDraft('leisureMinutes', value)}
          />
          <NumberInput
            label="Short leisure block"
            suffix=" min"
            min={15}
            max={120}
            step={15}
            allowDecimal={false}
            value={generatorDraft.shortLeisureBlockMinutes}
            onChange={(value) => updateGeneratorDraft('shortLeisureBlockMinutes', value)}
          />
          <NumberInput
            label="Maximum leisure block"
            suffix=" min"
            min={15}
            max={240}
            step={15}
            allowDecimal={false}
            value={generatorDraft.maxLeisureBlockMinutes}
            onChange={(value) => updateGeneratorDraft('maxLeisureBlockMinutes', value)}
          />
          <Checkbox
            label="Fill open time in the current day plan"
            checked={generatorDraft.fillExistingPlan}
            onChange={(event) =>
              setGeneratorDraft((current) => ({
                ...current,
                fillExistingPlan: event.currentTarget.checked,
              }))
            }
          />
          <Group justify="space-between">
            <Button
              variant="default"
              loading={saveGeneratorSettings.isPending}
              disabled={generatorDraftError}
              onClick={() => saveGeneratorSettings.mutate(generatorDraft)}
            >
              Save as default
            </Button>
            <Group gap="xs">
              <Button variant="subtle" onClick={() => setGeneratorOpen(false)}>
                Cancel
              </Button>
              <Button
                loading={generateDraft.isPending}
                disabled={!hasAvailability || generatorSettingsQuery.isPending || generatorDraftError}
                onClick={() =>
                  generateDraft.mutate(
                    { date: selectedDate, options: generatorDraft },
                    { onSuccess: () => setGeneratorOpen(false) }
                  )
                }
              >
                Generate
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={addCategoryBlockOpen}
        onClose={() => setAddCategoryBlockOpen(false)}
        title="Add category block"
        centered
        size="sm"
      >
        <Stack>
          <Select
            label="Category"
            value={categoryBlockCategory}
            data={planningCategories.map((category) => ({
              value: category,
              label: planningCategoryLabels[category],
            }))}
            onChange={(value) => value && setCategoryBlockCategory(value)}
          />
          <Select
            label="Start time"
            data={Array.from({ length: 72 }, (_, index) => {
              const total = 6 * 60 + index * 15;
              const time = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
              return { value: time, label: time };
            })}
            value={categoryBlockStart}
            onChange={(value) => value && setCategoryBlockStart(value)}
            searchable
          />
          <Select
            label="End time"
            data={Array.from({ length: 72 }, (_, index) => {
              const total = 6 * 60 + (index + 1) * 15;
              const time = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
              return { value: time, label: time };
            })}
            value={categoryBlockEnd}
            onChange={(value) => value && setCategoryBlockEnd(value)}
            searchable
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setAddCategoryBlockOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={createCategoryBlock.isPending}
              disabled={categoryBlockEnd <= categoryBlockStart}
              onClick={() =>
                createCategoryBlock.mutate(
                  {
                    date: selectedDate,
                    category: categoryBlockCategory as (typeof planningCategories)[number],
                    startsAt: `${selectedDate} ${categoryBlockStart}:00`,
                    endsAt: `${selectedDate} ${categoryBlockEnd}:00`,
                  },
                  { onSuccess: () => setAddCategoryBlockOpen(false) }
                )
              }
            >
              Add block
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(selectedCategorySlot)}
        onClose={() => setSelectedCategorySlotId(null)}
        title={selectedCategorySlot ? planningCategoryLabels[selectedCategorySlot.category] : 'Category slot'}
        centered
        size="sm"
      >
        {selectedCategorySlot && (
          <Stack>
            <Text size="sm" c="dimmed">
              {formatTime(selectedCategorySlot.startsAt, timezone)}–
              {formatTime(selectedCategorySlot.endsAt, timezone)}
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setSelectedCategorySlotId(null)}>
                Close
              </Button>
              {selectedCategorySlot.source === 'MANUAL' && (
                <Button
                  color="red"
                  loading={removeCategorySlot.isPending}
                  onClick={() =>
                    removeCategorySlot.mutate(
                      { date: selectedDate, slotId: selectedCategorySlot.id },
                      { onSuccess: () => setSelectedCategorySlotId(null) }
                    )
                  }
                >
                  Remove slot
                </Button>
              )}
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={clearPlanOpen}
        onClose={() => setClearPlanOpen(false)}
        title="Clear this day plan?"
        centered
        size="sm"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Planned blocks will be removed and unfinished tasks returned to the task list. Calendar
            events and tasks themselves will not be deleted.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setClearPlanOpen(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              loading={clearDayPlan.isPending}
              onClick={() =>
                clearDayPlan.mutate(
                  { date: selectedDate },
                  { onSuccess: () => setClearPlanOpen(false) }
                )
              }
            >
              Clear plan
            </Button>
          </Group>
        </Stack>
      </Modal>

      {selectedBlockInspector && <Portal target="#app-aside">{selectedBlockInspector}</Portal>}
    </Stack>
  );
}
