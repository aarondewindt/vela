import 'server-only';

import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '../../generated/prisma/client';
import type { PlanningCategoryValue, TaskRow } from './tasks';
import type { ViewConfig } from '@/lib/views/types';
import { recurrenceMatchesDate } from './recurrence';
import {
  classifyCandidate,
  DEFAULT_GENERATOR_OPTIONS,
  defaultLeadTimeDays,
  scheduleCandidates,
  WEEKDAY_PLANNING_PROFILE,
  WEEKEND_PLANNING_PROFILE,
  type GeneratorOptions,
  type TimeInterval,
} from './scheduling';

type TaskPatch = {
  title?: string;
  brief?: string | null;
  status?: TaskRow['status'];
  priority?: number;
  size?: number;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
  leadTimeDays?: number | null;
  themeId?: string | null;
  category?: PlanningCategoryValue | null;
  tags?: string[];
};

type ThemePatch = {
  name?: string;
  brief?: string | null;
  color?: string | null;
  category?: PlanningCategoryValue;
  isActive?: boolean;
};

const toDate = (value: string | null | undefined) =>
  value ? new Date(`${value}T00:00:00.000Z`) : value;

function localMinuteToInstant(date: string, minute: number, timezone: string): Date {
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
    if (correction === 0) {
      return new Date(instant);
    }
    instant += correction;
  }

  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: `Availability time does not exist in timezone ${timezone}`,
  });
}

function timeToMinute(value: Date | null): number | null {
  return value ? value.getUTCHours() * 60 + value.getUTCMinutes() : null;
}

// Temporary hardcoded defaults; move these into user settings when availability settings are built.
function standardAvailabilityWindows(weekday: number) {
  return [0, 6].includes(weekday)
    ? [{ startMinute: 10 * 60, endMinute: 24 * 60 }]
    : [
        { startMinute: 8 * 60, endMinute: 8 * 60 + 45 },
        { startMinute: 12 * 60, endMinute: 13 * 60 },
        { startMinute: 17 * 60 + 15, endMinute: 24 * 60 },
      ];
}

function customAvailability(
  date: string,
  timezone: string,
  override: {
    startTime: Date | null;
    endTime: Date | null;
    availabilityWindows: { startMinute: number; endMinute: number }[];
  }
): TimeInterval[] {
  const windows = override.availabilityWindows.length
    ? override.availabilityWindows
    : (() => {
        const startMinute = timeToMinute(override.startTime);
        const endMinute = timeToMinute(override.endTime);
        return startMinute !== null && endMinute !== null ? [{ startMinute, endMinute }] : [];
      })();

  return windows
    .filter(({ startMinute, endMinute }) => endMinute > startMinute)
    .map(({ startMinute, endMinute }) => ({
      start: localMinuteToInstant(date, startMinute, timezone),
      end: localMinuteToInstant(date, endMinute, timezone),
    }));
}

function nextDate(date: string): string {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function localDateTimeToInstant(value: string, timezone: string): Date {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid local date and time' });
  }
  const [, date, hour, minute, second = '0'] = match;
  const instant = localMinuteToInstant(date, Number(hour) * 60 + Number(minute), timezone);
  instant.setUTCSeconds(Number(second));
  return instant;
}

function assertSameDay(start: Date, end: Date, dayStart: Date, dayEnd: Date) {
  if (start < dayStart || end > dayEnd || end <= start) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Block must fit within the selected day' });
  }
}

// Manual/planner occurrences return to the backlog; recurring ones reset to pending.
async function releaseOccurrences(
  transaction: Prisma.TransactionClient,
  userId: string,
  occurrenceIds: string[]
) {
  for (const id of new Set(occurrenceIds)) {
    const occurrence = await transaction.taskOccurrence.findFirst({
      where: { id, userId, status: { notIn: ['DONE', 'CANCELED'] } },
      select: { origin: true, taskId: true },
    });
    if (!occurrence) continue;
    const inUse = await transaction.dailyBlock.count({
      where: { taskOccurrenceId: id, status: { not: 'CANCELED' }, plan: { isCurrent: true } },
    });
    if (inUse > 0) continue;

    if (occurrence.origin === 'RECURRENCE') {
      await transaction.taskOccurrence.update({
        where: { id },
        data: { status: 'PENDING', completedAt: null, skippedAt: null, canceledAt: null },
      });
    } else {
      await transaction.taskOccurrence.delete({ where: { id } });
      // Nothing planned or done remains, so the task goes back to the backlog.
      await transaction.task.updateMany({
        where: {
          id: occurrence.taskId,
          userId,
          isRecurring: false,
          status: 'IN_PROGRESS',
          occurrences: { none: {} },
        },
        data: { status: 'BACKLOG' },
      });
    }
  }
}

// Planning work on a task puts it in progress; recurring tasks keep their status.
async function startTasks(
  transaction: Prisma.TransactionClient,
  userId: string,
  occurrenceIds: string[],
  from: TaskRow['status'][] = ['BACKLOG']
) {
  if (occurrenceIds.length === 0) return;
  await transaction.task.updateMany({
    where: {
      userId,
      isRecurring: false,
      status: { in: from },
      occurrences: { some: { id: { in: occurrenceIds } } },
    },
    data: { status: 'IN_PROGRESS' },
  });
}

async function cancelOpenOccurrences(
  transaction: Prisma.TransactionClient,
  userId: string,
  taskId: string
) {
  const open = await transaction.taskOccurrence.findMany({
    where: { userId, taskId, status: { in: ['PENDING', 'SCHEDULED'] } },
    select: { id: true },
  });
  if (open.length === 0) return;
  const ids = open.map(({ id }) => id);
  await transaction.dailyBlock.updateMany({
    where: { userId, taskOccurrenceId: { in: ids }, status: 'PLANNED' },
    data: { status: 'CANCELED' },
  });
  await transaction.taskOccurrence.updateMany({
    where: { id: { in: ids } },
    data: { status: 'CANCELED', canceledAt: new Date() },
  });
}

function earliestDate(a: Date | null | undefined, b: Date | null | undefined) {
  if (!a || !b) return a ?? b ?? null;
  return a < b ? a : b;
}

// A prerequisite inherits the earliest due date of the tasks it blocks, through chains.
function inheritDueDates(
  edges: { blockedTaskId: string; dependsOnTaskId: string; blockedTask: { dueDate: Date | null } }[]
) {
  const inherited = new Map<string, Date>();
  for (let pass = 0; pass < edges.length; pass++) {
    let changed = false;
    for (const edge of edges) {
      const due = earliestDate(edge.blockedTask.dueDate, inherited.get(edge.blockedTaskId));
      const current = inherited.get(edge.dependsOnTaskId);
      if (due && (!current || due < current)) {
        inherited.set(edge.dependsOnTaskId, due);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return inherited;
}

async function materializeRecurringOccurrences(userId: string, planDate: Date) {
  const tasks = await prisma.task.findMany({
    where: {
      userId,
      isRecurring: true,
      recurrenceRule: { not: null },
      status: { notIn: ['DONE', 'ARCHIVED', 'PAUSED'] },
    },
    select: { id: true, recurrenceRule: true, createdAt: true },
  });
  const data = tasks.flatMap((task) => {
    const start = new Date(task.createdAt.toISOString().slice(0, 10));
    return Array.from(
      { length: 8 },
      (_, offset) => new Date(planDate.getTime() + offset * 86_400_000)
    )
      .filter((date) => recurrenceMatchesDate(task.recurrenceRule ?? '', start, date))
      .map((occurrenceDate) => ({
        userId,
        taskId: task.id,
        occurrenceDate,
        origin: 'RECURRENCE' as const,
      }));
  });
  if (data.length > 0) {
    await prisma.taskOccurrence.createMany({ data, skipDuplicates: true });
  }
}

async function assertOwnsTheme(userId: string, themeId: string | null | undefined) {
  if (!themeId) {
    return;
  }
  const theme = await prisma.theme.findFirst({
    where: { id: themeId, userId },
    select: { id: true },
  });
  if (!theme) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Theme not found' });
  }
}

export const plannerService = {
  async listTasks(userId: string): Promise<TaskRow[]> {
    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

    const tasks = await prisma.task.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }],
      include: {
        occurrences: {
          where: { status: { in: ['PENDING', 'SCHEDULED'] }, occurrenceDate: { gte: today } },
          orderBy: { occurrenceDate: 'asc' },
          take: 1,
          select: { occurrenceDate: true },
        },
      },
    });

    return tasks.map(({ occurrences, ...task }) => ({
      id: task.id,
      title: task.title,
      brief: task.brief,
      status: task.status,
      priority: task.priority,
      size: task.size,
      dueDate: task.dueDate,
      scheduledDate: occurrences[0]?.occurrenceDate ?? null,
      estimatedMinutes: task.estimatedMinutes,
      leadTimeDays: task.leadTimeDays,
      themeId: task.themeId,
      category: task.category,
      tags: task.tags,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    }));
  },

  async createTask(
    userId: string,
    input: { title: string; brief?: string; themeId?: string | null }
  ) {
    await assertOwnsTheme(userId, input.themeId);
    return prisma.task.create({
      data: { userId, title: input.title, brief: input.brief, themeId: input.themeId ?? null },
    });
  },

  async updateTask(userId: string, id: string, patch: TaskPatch) {
    await assertOwnsTheme(userId, patch.themeId);
    const { dueDate, ...rest } = patch;
    await prisma.$transaction(async (transaction) => {
      const result = await transaction.task.updateMany({
        where: { id, userId },
        data: { ...rest, ...(dueDate !== undefined && { dueDate: toDate(dueDate) }) },
      });
      if (!result.count) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      if (patch.status === 'DONE' || patch.status === 'ARCHIVED') {
        await cancelOpenOccurrences(transaction, userId, id);
      }
    });
  },

  async deleteTask(userId: string, id: string) {
    await prisma.task.deleteMany({ where: { id, userId } });
  },

  async getTaskContent(userId: string, id: string) {
    const task = await prisma.task.findFirst({ where: { id, userId }, select: { content: true } });
    if (!task) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    return task.content as unknown[] | null;
  },

  async updateTaskContent(userId: string, id: string, content: unknown[]) {
    const result = await prisma.task.updateMany({
      where: { id, userId },
      data: { content: content as Prisma.InputJsonValue },
    });
    if (!result.count) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
  },

  listThemes(userId: string) {
    return prisma.theme.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        brief: true,
        color: true,
        category: true,
        isActive: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  },

  async createTheme(userId: string, input: { name: string }) {
    const last = await prisma.theme.aggregate({ where: { userId }, _max: { sortOrder: true } });
    return prisma.theme.create({
      data: { userId, name: input.name, sortOrder: (last._max.sortOrder ?? -1) + 1 },
    });
  },

  async updateTheme(userId: string, id: string, patch: ThemePatch) {
    const result = await prisma.theme.updateMany({ where: { id, userId }, data: patch });
    if (!result.count) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
  },

  async reorderThemes(userId: string, orderedIds: string[]) {
    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.theme.updateMany({ where: { id, userId }, data: { sortOrder: index } })
      )
    );
  },

  async getThemeContent(userId: string, id: string) {
    const theme = await prisma.theme.findFirst({
      where: { id, userId },
      select: { content: true },
    });
    if (!theme) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    return theme.content as unknown[] | null;
  },

  async updateThemeContent(userId: string, id: string, content: unknown[]) {
    const result = await prisma.theme.updateMany({
      where: { id, userId },
      data: { content: content as Prisma.InputJsonValue },
    });
    if (!result.count) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
  },

  async listViews(userId: string, scope: string) {
    const views = await prisma.savedView.findMany({
      where: { userId, scope },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return views.map((view) => ({
      id: view.id,
      scope: view.scope,
      name: view.name,
      config: view.config as ViewConfig,
    }));
  },

  createView(userId: string, input: { scope: string; name: string; config: ViewConfig }) {
    return prisma.savedView.create({ data: { userId, ...input } });
  },

  async updateView(userId: string, id: string, patch: { name?: string; config?: ViewConfig }) {
    const result = await prisma.savedView.updateMany({ where: { id, userId }, data: patch });
    if (!result.count) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
  },

  async deleteView(userId: string, id: string) {
    await prisma.savedView.deleteMany({ where: { id, userId } });
  },

  async getGeneratorSettings(userId: string): Promise<GeneratorOptions> {
    const settings = await prisma.plannerGenerationSettings.findUnique({
      where: { userId },
      select: {
        workSessionMinutes: true,
        shortBreakMinutes: true,
        leisureMinutes: true,
        shortLeisureBlockMinutes: true,
        maxLeisureBlockMinutes: true,
        fillExistingPlan: true,
      },
    });
    return settings ?? DEFAULT_GENERATOR_OPTIONS;
  },

  saveGeneratorSettings(userId: string, settings: GeneratorOptions) {
    return prisma.plannerGenerationSettings.upsert({
      where: { userId },
      create: { userId, ...settings },
      update: settings,
      select: {
        workSessionMinutes: true,
        shortBreakMinutes: true,
        leisureMinutes: true,
        shortLeisureBlockMinutes: true,
        maxLeisureBlockMinutes: true,
        fillExistingPlan: true,
      },
    });
  },

  getPlan(userId: string, date: string) {
    return prisma.dailyPlan.findFirst({
      where: {
        userId,
        planDate: new Date(`${date}T00:00:00.000Z`),
        isCurrent: true,
      },
      include: {
        dailyBlocks: {
          orderBy: { startsAt: 'asc' },
          include: {
            taskOccurrence: { select: { taskId: true } },
            calendarEvent: { select: { id: true, isBusy: true } },
          },
        },
        categorySlots: { orderBy: { startsAt: 'asc' } },
      },
    });
  },

  async getDayData(userId: string, date: string) {
    const planDate = new Date(`${date}T00:00:00.000Z`);
    const nextDay = nextDate(date);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const start = localMinuteToInstant(date, 0, user.timezone);
    const end = localMinuteToInstant(nextDay, 0, user.timezone);
    const weekday = planDate.getUTCDay();
    const [plan, windows, override, events] = await Promise.all([
      this.getPlan(userId, date),
      prisma.availabilityWindow.findMany({
        where: { userId, weekday, isActive: true },
        orderBy: { startMinute: 'asc' },
      }),
      prisma.dayOverride.findUnique({
        where: { userId_overrideDate: { userId, overrideDate: planDate } },
        include: { availabilityWindows: { orderBy: { startMinute: 'asc' } } },
      }),
      prisma.calendarEvent.findMany({
        where: { userId, startsAt: { lt: end }, endsAt: { gt: start } },
        select: { id: true, title: true, startsAt: true, endsAt: true, isBusy: true },
        orderBy: { startsAt: 'asc' },
      }),
    ]);

    let availability: TimeInterval[] = [];
    if (override?.workMode === 'CUSTOM') {
      availability = customAvailability(date, user.timezone, override);
    } else if (override?.workMode !== 'NO_WORK' && override?.workMode !== 'PTO') {
      availability = windows
        .filter((window) => window.endMinute > window.startMinute)
        .map((window) => ({
          start: localMinuteToInstant(date, window.startMinute, user.timezone),
          end: localMinuteToInstant(date, window.endMinute, user.timezone),
        }));
    }

    return { plan, timezone: user.timezone, availability, override, events };
  },

  async applyStandardAvailability(
    userId: string,
    input: { date: string; scope: 'date' | 'recurring' }
  ) {
    const date = new Date(`${input.date}T00:00:00.000Z`);
    if (input.scope === 'date') {
      const intervals = standardAvailabilityWindows(date.getUTCDay());
      return prisma.dayOverride.upsert({
        where: { userId_overrideDate: { userId, overrideDate: date } },
        create: {
          userId,
          overrideDate: date,
          workMode: 'CUSTOM',
          availabilityWindows: {
            create: intervals,
          },
        },
        update: {
          workMode: 'CUSTOM',
          startTime: null,
          endTime: null,
          availabilityWindows: {
            deleteMany: {},
            create: intervals,
          },
        },
      });
    }

    const windows = Array.from({ length: 7 }, (_, weekday) => {
      return standardAvailabilityWindows(weekday).map(({ startMinute, endMinute }) => ({
        userId,
        weekday,
        startMinute,
        endMinute,
        isActive: true,
      }));
    }).flat();
    await prisma.$transaction([
      prisma.availabilityWindow.deleteMany({ where: { userId } }),
      prisma.availabilityWindow.createMany({ data: windows }),
    ]);
    return { scope: input.scope, windows };
  },

  async updateDayAvailability(
    userId: string,
    input: {
      date: string;
      windows: { startMinute: number; endMinute: number }[];
    }
  ) {
    const sortedWindows = [...input.windows].sort((a, b) => a.startMinute - b.startMinute);
    if (
      sortedWindows.some(
        ({ startMinute, endMinute }) =>
          startMinute < 0 ||
          startMinute >= endMinute ||
          endMinute > 24 * 60 ||
          startMinute % 15 !== 0 ||
          endMinute % 15 !== 0
      ) ||
      sortedWindows.some(
        (window, index) => index > 0 && window.startMinute < sortedWindows[index - 1].endMinute
      )
    ) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Availability slots must be valid, non-overlapping 15-minute intervals',
      });
    }

    const overrideDate = new Date(`${input.date}T00:00:00.000Z`);
    return prisma.dayOverride.upsert({
      where: { userId_overrideDate: { userId, overrideDate } },
      create: {
        userId,
        overrideDate,
        workMode: 'CUSTOM',
        availabilityWindows: { create: sortedWindows },
      },
      update: {
        workMode: 'CUSTOM',
        startTime: null,
        endTime: null,
        availabilityWindows: {
          deleteMany: {},
          create: sortedWindows,
        },
      },
    });
  },

  async createManualBlock(
    userId: string,
    input: { date: string; taskId: string; startsAt: string }
  ) {
    const planDate = new Date(`${input.date}T00:00:00.000Z`);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const startsAt = localDateTimeToInstant(input.startsAt, user.timezone);
    const task = await prisma.task.findFirst({
      where: { id: input.taskId, userId, status: { notIn: ['DONE', 'ARCHIVED', 'PAUSED'] } },
      select: {
        id: true,
        title: true,
        firstStep: true,
        estimatedMinutes: true,
        category: true,
        theme: { select: { category: true } },
      },
    });
    if (!task) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Open task not found' });
    }
    const durationMinutes =
      task.estimatedMinutes && task.estimatedMinutes > 0 ? task.estimatedMinutes : 25;
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    assertSameDay(
      startsAt,
      endsAt,
      localMinuteToInstant(input.date, 0, user.timezone),
      localMinuteToInstant(nextDate(input.date), 0, user.timezone)
    );

    return prisma.$transaction(async (transaction) => {
      let plan = await transaction.dailyPlan.findFirst({
        where: { userId, planDate, isCurrent: true },
        select: { id: true },
      });
      if (!plan) {
        const latest = await transaction.dailyPlan.findFirst({
          where: { userId, planDate },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        plan = await transaction.dailyPlan.create({
          data: {
            userId,
            planDate,
            timezone: user.timezone,
            version: (latest?.version ?? 0) + 1,
            isCurrent: true,
            generatedBy: 'MANUAL',
          },
          select: { id: true },
        });
      }

      const occurrence = await transaction.taskOccurrence.upsert({
        where: { taskId_occurrenceDate: { taskId: task.id, occurrenceDate: planDate } },
        create: { userId, taskId: task.id, occurrenceDate: planDate, origin: 'MANUAL' },
        update: {},
        select: { id: true, status: true },
      });
      // The task is open, so a closed occurrence on this day means it was reopened.
      const [overlap, calendarConflict, existingBlock] = await Promise.all([
        transaction.dailyBlock.findFirst({
          where: {
            userId,
            planId: plan.id,
            status: { in: ['PLANNED', 'IN_PROGRESS', 'DONE'] },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
          select: { id: true },
        }),
        transaction.calendarEvent.findFirst({
          where: {
            userId,
            isBusy: true,
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
          select: { id: true },
        }),
        transaction.dailyBlock.findFirst({
          where: {
            planId: plan.id,
            taskOccurrenceId: occurrence.id,
            status: { in: ['PLANNED', 'IN_PROGRESS'] },
          },
          select: { id: true },
        }),
      ]);
      if (overlap || calendarConflict || existingBlock) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'The selected time is no longer available',
        });
      }

      const block = await transaction.dailyBlock.create({
        data: {
          userId,
          planId: plan.id,
          taskOccurrenceId: occurrence.id,
          title: task.title,
          brief: task.firstStep,
          category: task.category ?? task.theme?.category ?? 'WORK',
          startsAt,
          endsAt,
          durationMinutes,
          source: 'MANUAL',
          position: 0,
        },
      });
      await transaction.taskOccurrence.update({
        where: { id: occurrence.id },
        data: { status: 'SCHEDULED', completedAt: null, skippedAt: null, canceledAt: null },
      });
      await startTasks(transaction, userId, [occurrence.id]);
      return block;
    });
  },

  async createManualCategoryBlock(
    userId: string,
    input: {
      date: string;
      category: PlanningCategoryValue;
      startsAt: string;
      endsAt: string;
    }
  ) {
    const planDate = new Date(`${input.date}T00:00:00.000Z`);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const startsAt = localDateTimeToInstant(input.startsAt, user.timezone);
    const endsAt = localDateTimeToInstant(input.endsAt, user.timezone);
    assertSameDay(
      startsAt,
      endsAt,
      localMinuteToInstant(input.date, 0, user.timezone),
      localMinuteToInstant(nextDate(input.date), 0, user.timezone)
    );

    return prisma.$transaction(async (transaction) => {
      let plan = await transaction.dailyPlan.findFirst({
        where: { userId, planDate, isCurrent: true },
        select: { id: true },
      });
      if (!plan) {
        const latest = await transaction.dailyPlan.findFirst({
          where: { userId, planDate },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        plan = await transaction.dailyPlan.create({
          data: {
            userId,
            planDate,
            timezone: user.timezone,
            version: (latest?.version ?? 0) + 1,
            isCurrent: true,
            generatedBy: 'MANUAL',
          },
          select: { id: true },
        });
      }
      const [categorySlotOverlap, calendarConflict] = await Promise.all([
        transaction.dailyPlanCategorySlot.findFirst({
          where: {
            planId: plan.id,
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
          select: { id: true },
        }),
        transaction.calendarEvent.findFirst({
          where: { userId, isBusy: true, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
          select: { id: true },
        }),
      ]);
      if (categorySlotOverlap || calendarConflict) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'The selected time is no longer available',
        });
      }
      return transaction.dailyPlanCategorySlot.create({
        data: {
          planId: plan.id,
          category: input.category,
          startsAt,
          endsAt,
          source: 'MANUAL',
        },
      });
    });
  },

  async removeCategorySlot(userId: string, input: { date: string; slotId: string }) {
    const planDate = new Date(`${input.date}T00:00:00.000Z`);
    const slot = await prisma.dailyPlanCategorySlot.findFirst({
      where: {
        id: input.slotId,
        plan: { userId, planDate, isCurrent: true },
      },
      select: { id: true },
    });
    if (!slot) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Category slot not found' });
    }
    return prisma.dailyPlanCategorySlot.delete({ where: { id: slot.id } });
  },

  async updateCategorySlotTime(
    userId: string,
    input: { date: string; slotId: string; startsAt: string; endsAt: string }
  ) {
    const planDate = new Date(`${input.date}T00:00:00.000Z`);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const startsAt = localDateTimeToInstant(input.startsAt, user.timezone);
    const endsAt = localDateTimeToInstant(input.endsAt, user.timezone);
    assertSameDay(
      startsAt,
      endsAt,
      localMinuteToInstant(input.date, 0, user.timezone),
      localMinuteToInstant(nextDate(input.date), 0, user.timezone)
    );

    return prisma.$transaction(async (transaction) => {
      const slot = await transaction.dailyPlanCategorySlot.findFirst({
        where: {
          id: input.slotId,
          plan: { userId, planDate, isCurrent: true },
        },
        select: { id: true, planId: true },
      });
      if (!slot) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Editable category slot not found' });
      }
      const [overlap, calendarConflict] = await Promise.all([
        transaction.dailyPlanCategorySlot.findFirst({
          where: {
            planId: slot.planId,
            id: { not: slot.id },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
          select: { id: true },
        }),
        transaction.calendarEvent.findFirst({
          where: { userId, isBusy: true, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
          select: { id: true },
        }),
      ]);
      if (overlap || calendarConflict) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'The selected time overlaps another category slot or busy event',
        });
      }
      return transaction.dailyPlanCategorySlot.update({
        where: { id: slot.id },
        data: { startsAt, endsAt },
      });
    });
  },

  async updateBlockTime(
    userId: string,
    input: { date: string; blockId: string; startsAt: string; endsAt: string }
  ) {
    const planDate = new Date(`${input.date}T00:00:00.000Z`);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const startsAt = localDateTimeToInstant(input.startsAt, user.timezone);
    const endsAt = localDateTimeToInstant(input.endsAt, user.timezone);
    assertSameDay(
      startsAt,
      endsAt,
      localMinuteToInstant(input.date, 0, user.timezone),
      localMinuteToInstant(nextDate(input.date), 0, user.timezone)
    );

    return prisma.$transaction(async (transaction) => {
      const block = await transaction.dailyBlock.findFirst({
        where: {
          id: input.blockId,
          userId,
          status: 'PLANNED',
          plan: { planDate, isCurrent: true },
        },
        select: { id: true },
      });
      if (!block) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Editable block not found' });
      }
      const [overlap, calendarConflict] = await Promise.all([
        transaction.dailyBlock.findFirst({
          where: {
            userId,
            plan: { planDate, isCurrent: true },
            id: { not: block.id },
            status: { in: ['PLANNED', 'IN_PROGRESS', 'DONE'] },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
          select: { id: true },
        }),
        transaction.calendarEvent.findFirst({
          where: { userId, isBusy: true, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
          select: { id: true },
        }),
      ]);
      if (overlap || calendarConflict) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'The selected time overlaps another event',
        });
      }
      return transaction.dailyBlock.update({
        where: { id: block.id },
        data: {
          startsAt,
          endsAt,
          durationMinutes: Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000),
        },
      });
    });
  },

  async removeBlockFromDay(userId: string, input: { date: string; blockId: string }) {
    const planDate = new Date(`${input.date}T00:00:00.000Z`);
    return prisma.$transaction(async (transaction) => {
      const block = await transaction.dailyBlock.findFirst({
        where: {
          id: input.blockId,
          userId,
          plan: { planDate, isCurrent: true },
          status: { in: ['PLANNED', 'SKIPPED'] },
        },
        select: { id: true, taskOccurrenceId: true },
      });
      if (!block) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Open block not found' });
      }

      if (block.taskOccurrenceId) {
        await transaction.dailyBlock.delete({ where: { id: block.id } });
        await releaseOccurrences(transaction, userId, [block.taskOccurrenceId]);
        return block;
      }
      return transaction.dailyBlock.delete({ where: { id: block.id } });
    });
  },

  async updateBlockOutcome(
    userId: string,
    input: {
      date: string;
      blockId: string;
      outcome: 'DONE' | 'SKIPPED';
      completeTask?: boolean;
    }
  ) {
    const planDate = new Date(`${input.date}T00:00:00.000Z`);
    return prisma.$transaction(async (transaction) => {
      const block = await transaction.dailyBlock.findFirst({
        where: {
          id: input.blockId,
          userId,
          plan: { planDate, isCurrent: true },
          status: { in: ['PLANNED', 'IN_PROGRESS', 'DONE', 'SKIPPED'] },
        },
        select: { id: true, taskOccurrenceId: true },
      });
      if (!block) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Block not found' });
      }
      const completedAt = input.outcome === 'DONE' ? new Date() : null;
      const updated = await transaction.dailyBlock.update({
        where: { id: block.id },
        data: { status: input.outcome, completedAt },
      });
      if (block.taskOccurrenceId) {
        await transaction.taskOccurrence.update({
          where: { id: block.taskOccurrenceId },
          data:
            input.outcome === 'DONE'
              ? { status: 'DONE', completedAt }
              : { status: 'PENDING', completedAt: null, skippedAt: null },
        });
        if (input.outcome === 'DONE') {
          if (input.completeTask) {
            const occurrence = await transaction.taskOccurrence.findUniqueOrThrow({
              where: { id: block.taskOccurrenceId },
              select: { taskId: true },
            });
            const completed = await transaction.task.updateMany({
              where: {
                id: occurrence.taskId,
                userId,
                isRecurring: false,
                status: { in: ['BACKLOG', 'IN_PROGRESS'] },
              },
              data: { status: 'DONE' },
            });
            if (completed.count) {
              await cancelOpenOccurrences(transaction, userId, occurrence.taskId);
            }
          } else {
            await startTasks(transaction, userId, [block.taskOccurrenceId], ['BACKLOG', 'DONE']);
          }
        }
      }
      return updated;
    });
  },

  async unskipBlock(userId: string, input: { date: string; blockId: string }) {
    const planDate = new Date(`${input.date}T00:00:00.000Z`);
    return prisma.$transaction(async (transaction) => {
      const block = await transaction.dailyBlock.findFirst({
        where: {
          id: input.blockId,
          userId,
          plan: { planDate, isCurrent: true },
          status: 'SKIPPED',
        },
        select: { id: true, taskOccurrenceId: true },
      });
      if (!block) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skipped block not found' });
      }

      const updated = await transaction.dailyBlock.update({
        where: { id: block.id },
        data: { status: 'PLANNED', completedAt: null },
      });
      if (block.taskOccurrenceId) {
        await transaction.taskOccurrence.update({
          where: { id: block.taskOccurrenceId },
          data: { status: 'SCHEDULED', completedAt: null, skippedAt: null, canceledAt: null },
        });
        await startTasks(transaction, userId, [block.taskOccurrenceId], ['BACKLOG', 'DONE']);
      }
      return updated;
    });
  },

  async acceptDraft(userId: string, date: string) {
    const planDate = new Date(`${date}T00:00:00.000Z`);
    return prisma.$transaction(async (transaction) => {
      const plan = await transaction.dailyPlan.findFirst({
        where: { userId, planDate, isCurrent: true },
        select: { id: true, status: true },
      });
      if (!plan) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Current plan not found' });
      }
      if (plan.status !== 'DRAFT') {
        throw new TRPCError({ code: 'CONFLICT', message: 'Current plan is not a draft' });
      }
      return transaction.dailyPlan.update({
        where: { id: plan.id },
        data: { status: 'ACTIVE' },
      });
    });
  },

  async clearDayPlan(userId: string, date: string) {
    const planDate = new Date(`${date}T00:00:00.000Z`);
    return prisma.$transaction(async (transaction) => {
      const plan = await transaction.dailyPlan.findFirst({
        where: { userId, planDate, isCurrent: true },
        select: {
          id: true,
          dailyBlocks: { select: { taskOccurrenceId: true } },
        },
      });
      if (!plan) {
        return { cleared: false };
      }

      await transaction.dailyBlock.deleteMany({ where: { planId: plan.id } });
      await releaseOccurrences(
        transaction,
        userId,
        plan.dailyBlocks.flatMap(({ taskOccurrenceId }) =>
          taskOccurrenceId ? [taskOccurrenceId] : []
        )
      );
      return { cleared: true };
    });
  },

  async generateDraft(userId: string, date: string, options?: GeneratorOptions) {
    const planDate = new Date(`${date}T00:00:00.000Z`);
    const generatorOptions = options ?? (await this.getGeneratorSettings(userId));
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const weekday = planDate.getUTCDay();
    const profile = {
      ...(weekday === 0 || weekday === 6
        ? WEEKEND_PLANNING_PROFILE
        : WEEKDAY_PLANNING_PROFILE),
      gapMinutes: generatorOptions.shortBreakMinutes,
      sessionMinutes: generatorOptions.workSessionMinutes,
      leisureMinutes: generatorOptions.leisureMinutes,
      shortLeisureBlockMinutes: generatorOptions.shortLeisureBlockMinutes,
      maxLeisureBlockMinutes: generatorOptions.maxLeisureBlockMinutes,
    };
    await materializeRecurringOccurrences(userId, planDate);
    const [windows, override, currentPlan, dependencies] = await Promise.all([
      prisma.availabilityWindow.findMany({
        where: { userId, weekday, isActive: true },
        orderBy: { startMinute: 'asc' },
      }),
      prisma.dayOverride.findUnique({
        where: { userId_overrideDate: { userId, overrideDate: planDate } },
        include: { availabilityWindows: { orderBy: { startMinute: 'asc' } } },
      }),
      prisma.dailyPlan.findFirst({
        where: { userId, planDate, isCurrent: true },
        include: {
          dailyBlocks: {
            include: {
              taskOccurrence: { select: { taskId: true } },
              calendarEvent: { select: { isBusy: true } },
            },
          },
          categorySlots: { orderBy: { startsAt: 'asc' } },
        },
      }),
      prisma.taskDependency.findMany({
        where: {
          userId,
          isHardBlock: true,
          blockedTask: { status: { notIn: ['DONE', 'ARCHIVED'] } },
        },
        select: {
          blockedTaskId: true,
          dependsOnTaskId: true,
          dependsOnTask: { select: { status: true } },
          blockedTask: { select: { dueDate: true } },
        },
      }),
    ]);
    const blockedTaskIds = dependencies
      .filter(({ dependsOnTask }) => !['DONE', 'ARCHIVED'].includes(dependsOnTask.status))
      .map(({ blockedTaskId }) => blockedTaskId);
    const inheritedDue = inheritDueDates(dependencies);

    const dayStart = localMinuteToInstant(date, 0, user.timezone);
    const nextDay = new Date(planDate.getTime() + 86_400_000).toISOString().slice(0, 10);
    const dayEnd = localMinuteToInstant(nextDay, 0, user.timezone);
    let availability: TimeInterval[] = [];

    if (override?.workMode !== 'NO_WORK' && override?.workMode !== 'PTO') {
      if (override?.workMode === 'CUSTOM') {
        availability = customAvailability(date, user.timezone, override);
      } else {
        availability = windows
          .filter((window) => window.endMinute > window.startMinute)
          .map((window) => ({
            start: localMinuteToInstant(date, window.startMinute, user.timezone),
            end: localMinuteToInstant(date, window.endMinute, user.timezone),
          }));
      }
    }

    const existingBlocks = currentPlan?.dailyBlocks ?? [];
    const categorySlots = generatorOptions.fillExistingPlan ? (currentPlan?.categorySlots ?? []) : [];
    const protectedBlocks = generatorOptions.fillExistingPlan
      ? existingBlocks.filter((block) => block.status !== 'CANCELED')
      : existingBlocks.filter(
          (block) =>
            (block.source === 'MANUAL' && block.status === 'PLANNED') ||
            (block.isFixed && ['PLANNED', 'IN_PROGRESS'].includes(block.status)) ||
            ['IN_PROGRESS', 'DONE'].includes(block.status)
        );
    const alreadyPlannedTaskIds = protectedBlocks.flatMap((block) =>
      block.status !== 'DONE' && block.taskOccurrence ? [block.taskOccurrence.taskId] : []
    );

    const [calendarEvents, occurrences, backlogTasks, priorTaskBlocks] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: { userId, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
        select: { id: true, title: true, brief: true, startsAt: true, endsAt: true, isBusy: true },
      }),
      prisma.taskOccurrence.findMany({
        where: {
          userId,
          occurrenceDate: { lte: planDate },
          status: { in: ['PENDING', 'SCHEDULED'] },
          taskId: { notIn: blockedTaskIds },
          task: { status: { notIn: ['DONE', 'ARCHIVED', 'PAUSED'] } },
        },
        include: {
          task: {
            select: {
              title: true,
              priority: true,
              size: true,
              estimatedMinutes: true,
              leadTimeDays: true,
              firstStep: true,
              category: true,
              theme: { select: { category: true } },
            },
          },
        },
        orderBy: [{ dueAt: 'asc' }, { occurrenceDate: 'asc' }],
      }),
      prisma.task.findMany({
        where: {
          userId,
          isRecurring: false,
          status: { in: ['BACKLOG', 'IN_PROGRESS'] },
          id: { notIn: [...blockedTaskIds, ...alreadyPlannedTaskIds] },
          OR: [{ earliestStartAt: null }, { earliestStartAt: { lt: dayEnd } }],
          occurrences: { none: { status: { in: ['PENDING', 'SCHEDULED'] } } },
        },
        select: {
          id: true,
          title: true,
          priority: true,
          size: true,
          estimatedMinutes: true,
          leadTimeDays: true,
          firstStep: true,
          dueDate: true,
          category: true,
          theme: { select: { category: true } },
        },
      }),
      prisma.dailyBlock.findMany({
        where: {
          userId,
          status: { in: ['PLANNED', 'IN_PROGRESS', 'DONE'] },
          plan: {
            isCurrent: true,
            ...(generatorOptions.fillExistingPlan ? {} : { planDate: { not: planDate } }),
          },
          taskOccurrence: { isNot: null },
        },
        select: {
          taskOccurrenceId: true,
          durationMinutes: true,
          taskOccurrence: { select: { taskId: true } },
        },
      }),
    ]);

    const protectedOccurrenceIds = new Set(
      protectedBlocks.flatMap((block) => (block.taskOccurrenceId ? [block.taskOccurrenceId] : []))
    );
    const skippedOccurrenceIds = new Set(
      protectedBlocks.flatMap((block) =>
        block.status === 'SKIPPED' && block.taskOccurrenceId ? [block.taskOccurrenceId] : []
      )
    );
    const eligibleOccurrences = occurrences.filter((occurrence) => {
      if (
        skippedOccurrenceIds.has(occurrence.id) ||
        (!generatorOptions.fillExistingPlan && protectedOccurrenceIds.has(occurrence.id))
      ) {
        return false;
      }
      const dueAt = occurrence.dueAt ?? occurrence.occurrenceDate;
      return dueAt < dayEnd;
    });
    const taskMinutesScheduled = new Map<string, number>();
    const occurrenceMinutesScheduled = new Map<string, number>();
    for (const block of priorTaskBlocks) {
      if (block.taskOccurrenceId) {
        occurrenceMinutesScheduled.set(
          block.taskOccurrenceId,
          (occurrenceMinutesScheduled.get(block.taskOccurrenceId) ?? 0) + block.durationMinutes
        );
      }
      if (block.taskOccurrence) {
        taskMinutesScheduled.set(
          block.taskOccurrence.taskId,
          (taskMinutesScheduled.get(block.taskOccurrence.taskId) ?? 0) + block.durationMinutes
        );
      }
    }
    const existingLeisureMinutes = generatorOptions.fillExistingPlan
      ? categorySlots
          .filter((slot) => slot.category === 'LEISURE')
          .reduce(
            (total, slot) =>
              total + Math.ceil((slot.endsAt.getTime() - slot.startsAt.getTime()) / 60_000),
            0
          )
      : 0;
    profile.leisureMinutes = Math.max(
      0,
      generatorOptions.leisureMinutes - existingLeisureMinutes
    );
    const sources = new Map<
      string,
      {
        taskId: string;
        occurrenceId: string | null;
        firstStep: string | null;
        category: PlanningCategoryValue;
      }
    >();
    const candidates = [
      ...eligibleOccurrences.map((occurrence) => ({
        id: occurrence.id,
        taskId: occurrence.taskId,
        occurrenceId: occurrence.id,
        task: occurrence.task,
        due: earliestDate(
          occurrence.dueAt ?? occurrence.occurrenceDate,
          inheritedDue.get(occurrence.taskId)
        ),
      })),
      ...backlogTasks.map((task) => ({
        id: `task:${task.id}`,
        taskId: task.id,
        occurrenceId: null,
        task,
        due: earliestDate(task.dueDate, inheritedDue.get(task.id)),
      })),
    ].flatMap((source) => {
      const { task } = source;
      const estimatedMinutes = task.estimatedMinutes ?? 25;
      const alreadyScheduled = source.occurrenceId
        ? (occurrenceMinutesScheduled.get(source.occurrenceId) ?? 0)
        : (taskMinutesScheduled.get(source.taskId) ?? 0);
      const durationMinutes = Math.max(0, estimatedMinutes - alreadyScheduled);
      if (durationMinutes === 0) {
        return [];
      }
      const daysUntilDue = source.due
        ? Math.floor((source.due.getTime() - planDate.getTime()) / 86_400_000)
        : null;
      const classifiedTier = classifyCandidate({
        priority: task.priority,
        size: task.size,
        daysUntilDue,
        leadTimeDays: task.leadTimeDays ?? defaultLeadTimeDays(task.size, task.priority),
      });
      sources.set(source.id, {
        taskId: source.taskId,
        occurrenceId: source.occurrenceId,
        firstStep: task.firstStep,
        category: task.category ?? task.theme?.category ?? 'WORK',
      });
      return [{
        id: source.id,
        title: task.title,
        priority: task.priority,
        size: task.size,
        tier:
          classifiedTier === 'FILLER' && durationMinutes > profile.sessionMinutes
            ? 'IMPORTANT'
            : classifiedTier,
        daysUntilDue,
        dueAt: source.due,
        durationMinutes,
        category: task.category ?? task.theme?.category ?? 'WORK',
      }];
    });
    const busy: TimeInterval[] = [
      ...calendarEvents
        .filter(({ isBusy }) => isBusy)
        .map(({ startsAt, endsAt }) => ({ start: startsAt, end: endsAt })),
      ...protectedBlocks
        .filter(
          (block) =>
            ['PLANNED', 'IN_PROGRESS', 'DONE'].includes(block.status) &&
            (!block.calendarEventId || block.calendarEvent?.isBusy)
        )
        .map(({ startsAt, endsAt }) => ({ start: startsAt, end: endsAt })),
    ];
    const schedule = scheduleCandidates({
      candidates,
      availability,
      busy,
      profile,
      categorySlots: categorySlots.map((slot) => ({
        id: slot.id,
        category: slot.category,
        start: slot.startsAt,
        end: slot.endsAt,
      })),
    });

    return prisma.$transaction(async (transaction) => {
      const latestPlan = await transaction.dailyPlan.findFirst({
        where: { userId, planDate },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const droppedBlocks = await transaction.dailyBlock.findMany({
        where: {
          userId,
          plan: { planDate, isCurrent: true },
          taskOccurrenceId: { not: null },
          id: { notIn: protectedBlocks.map(({ id }) => id) },
        },
        select: { taskOccurrenceId: true },
      });
      await transaction.dailyPlan.updateMany({
        where: { userId, planDate, isCurrent: true },
        data: { isCurrent: false },
      });

      const copiedBlocks = protectedBlocks.map((block) => ({
        userId,
        title: block.title,
        brief: block.brief,
        content: block.content ?? undefined,
        startsAt: block.startsAt,
        endsAt: block.endsAt,
        durationMinutes: block.durationMinutes,
        status: block.status,
        source: block.source,
        position: block.position,
        isFixed: block.isFixed,
        completedAt: block.completedAt,
        taskOccurrenceId: block.taskOccurrenceId,
        calendarEventId: block.calendarEventId,
        category: block.category,
      }));
      const occurrenceIds = new Map<string, string>();
      for (const block of schedule.scheduled) {
        const source = sources.get(block.id);
        if (source?.occurrenceId) {
          occurrenceIds.set(block.id, source.occurrenceId);
        } else if (source) {
          // A closed occurrence on this day means the task was reopened.
          const created = await transaction.taskOccurrence.upsert({
            where: {
              taskId_occurrenceDate: { taskId: source.taskId, occurrenceDate: planDate },
            },
            create: { userId, taskId: source.taskId, occurrenceDate: planDate, origin: 'MANUAL' },
            update: { status: 'SCHEDULED', completedAt: null, skippedAt: null, canceledAt: null },
            select: { id: true },
          });
          occurrenceIds.set(block.id, created.id);
        }
      }
      const plannedBlocks = [
        ...schedule.scheduled.map((block) => ({
          userId,
          title: block.title,
          brief: sources.get(block.id)?.firstStep ?? null,
          taskOccurrenceId: occurrenceIds.get(block.id) ?? null,
          calendarEventId: null,
          category: block.category,
          startsAt: block.start,
          endsAt: block.end,
          durationMinutes: block.durationMinutes,
          status: 'PLANNED' as const,
          source: 'PLANNER' as const,
        })),
        ...schedule.breaks.map((block) => ({
          userId,
          title: block.title,
          brief: null,
          taskOccurrenceId: null,
          calendarEventId: null,
          category: block.category,
          startsAt: block.start,
          endsAt: block.end,
          durationMinutes: block.durationMinutes,
          status: 'PLANNED' as const,
          source: 'PLANNER' as const,
        })),
        ...calendarEvents
          .filter(
            (event) =>
              !protectedBlocks.some((block) => block.calendarEventId === event.id)
          )
          .map((event) => {
          const startsAt = event.startsAt < dayStart ? dayStart : event.startsAt;
          const endsAt = event.endsAt > dayEnd ? dayEnd : event.endsAt;
          return {
            userId,
            title: event.title,
            brief: event.brief,
            taskOccurrenceId: null,
            calendarEventId: event.id,
            category: null,
            startsAt,
            endsAt,
            durationMinutes: Math.max(1, Math.ceil((endsAt.getTime() - startsAt.getTime()) / 60_000)),
            status: 'PLANNED' as const,
            source: 'AUTOMATION' as const,
          };
        }),
      ]
        .toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        .map((block, index) => ({ ...block, position: copiedBlocks.length + index }));
      const plan = await transaction.dailyPlan.create({
        data: {
          userId,
          planDate,
          timezone: user.timezone,
          status: 'DRAFT',
          version: (latestPlan?.version ?? 0) + 1,
          isCurrent: true,
          generatedBy: 'AUTOMATION',
          explanationJson: {
            candidateCount: candidates.length,
            scheduledCount: schedule.scheduled.length,
            restBreakCount: schedule.breaks.length,
            leisureMinutes: schedule.leisure.reduce((total, block) => total + block.durationMinutes, 0),
            generatorOptions,
            scheduled: schedule.scheduled.map(({ id, tier }) => ({
              taskId: sources.get(id)?.taskId,
              tier,
            })),
            unscheduled: schedule.unscheduled.map(({ candidate, reason }) => ({
              taskId: sources.get(candidate.id)?.taskId,
              tier: candidate.tier,
              reason,
            })),
            availability: availability.map(({ start, end }) => ({
              startsAt: start.toISOString(),
              endsAt: end.toISOString(),
            })),
          },
          dailyBlocks: { create: [...copiedBlocks, ...plannedBlocks] },
          categorySlots: {
            create: [
              ...categorySlots.map((slot) => ({
                category: slot.category,
                startsAt: slot.startsAt,
                endsAt: slot.endsAt,
                source: slot.source,
              })),
              ...schedule.leisure.map((slot) => ({
                category: 'LEISURE' as const,
                startsAt: slot.start,
                endsAt: slot.end,
                source: 'PLANNER' as const,
              })),
              ...schedule.reservations.map((slot) => ({
                category: slot.category,
                startsAt: slot.start,
                endsAt: slot.end,
                source: 'PLANNER' as const,
              })),
            ],
          },
        },
        include: {
          dailyBlocks: { orderBy: { startsAt: 'asc' } },
          categorySlots: { orderBy: { startsAt: 'asc' } },
        },
      });

      for (const occurrenceId of occurrenceIds.values()) {
        await transaction.taskOccurrence.updateMany({
          where: { id: occurrenceId, userId, status: { in: ['PENDING', 'SCHEDULED'] } },
          data: { status: 'SCHEDULED' },
        });
      }

      await startTasks(transaction, userId, [...occurrenceIds.values()]);

      await releaseOccurrences(
        transaction,
        userId,
        droppedBlocks.flatMap(({ taskOccurrenceId }) =>
          taskOccurrenceId ? [taskOccurrenceId] : []
        )
      );

      return plan;
    });
  },
};
