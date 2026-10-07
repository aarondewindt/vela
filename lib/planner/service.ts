import 'server-only';

import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '../../generated/prisma/client';
import type { TaskRow } from './tasks';
import type { ViewConfig } from '@/lib/views/types';
import {
  scheduleCandidates,
  WEEKDAY_PLANNING_PROFILE,
  WEEKEND_PLANNING_PROFILE,
  type CandidateTier,
  type TimeInterval,
} from './scheduling';

type TaskPatch = {
  title?: string;
  brief?: string | null;
  status?: TaskRow['status'];
  priority?: number;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
  themeId?: string | null;
  tags?: string[];
};

type ThemePatch = {
  name?: string;
  brief?: string | null;
  color?: string | null;
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

function candidateTier(priority: number, durationMinutes: number): CandidateTier {
  if (priority === 1) return 'P1';
  if (priority === 2) return 'P2';
  if (durationMinutes <= 15) return 'XS';
  return 'OTHER';
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
      dueDate: task.dueDate,
      scheduledDate: occurrences[0]?.occurrenceDate ?? null,
      estimatedMinutes: task.estimatedMinutes,
      themeId: task.themeId,
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
    const result = await prisma.task.updateMany({
      where: { id, userId },
      data: { ...rest, ...(dueDate !== undefined && { dueDate: toDate(dueDate) }) },
    });
    if (!result.count) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
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
        },
      },
    });
  },

  async generateDraft(userId: string, date: string) {
    const planDate = new Date(`${date}T00:00:00.000Z`);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const weekday = planDate.getUTCDay();
    const profile =
      weekday === 0 || weekday === 6 ? WEEKEND_PLANNING_PROFILE : WEEKDAY_PLANNING_PROFILE;
    const [windows, override, currentPlan, blockers] = await Promise.all([
      prisma.availabilityWindow.findMany({
        where: { userId, weekday, isActive: true },
        orderBy: { startMinute: 'asc' },
      }),
      prisma.dayOverride.findUnique({
        where: { userId_overrideDate: { userId, overrideDate: planDate } },
      }),
      prisma.dailyPlan.findFirst({
        where: { userId, planDate, isCurrent: true },
        include: {
          dailyBlocks: {
            where: {
              OR: [
                { source: 'MANUAL', status: 'PLANNED' },
                { isFixed: true, status: { in: ['PLANNED', 'IN_PROGRESS'] } },
                { status: { in: ['IN_PROGRESS', 'DONE'] } },
              ],
            },
          },
        },
      }),
      prisma.taskDependency.findMany({
        where: {
          userId,
          isHardBlock: true,
          dependsOnTask: { status: { notIn: ['DONE', 'ARCHIVED'] } },
        },
        select: { blockedTaskId: true },
      }),
    ]);

    const dayStart = localMinuteToInstant(date, 0, user.timezone);
    const nextDay = new Date(planDate.getTime() + 86_400_000).toISOString().slice(0, 10);
    const dayEnd = localMinuteToInstant(nextDay, 0, user.timezone);
    const overrideStart = timeToMinute(override?.startTime ?? null);
    const overrideEnd = timeToMinute(override?.endTime ?? null);
    let availability: TimeInterval[] = [];

    if (override?.workMode !== 'NO_WORK' && override?.workMode !== 'PTO') {
      if (override?.workMode === 'CUSTOM') {
        if (overrideStart !== null && overrideEnd !== null && overrideEnd > overrideStart) {
          availability = [
            {
              start: localMinuteToInstant(date, overrideStart, user.timezone),
              end: localMinuteToInstant(date, overrideEnd, user.timezone),
            },
          ];
        }
      } else {
        availability = windows
          .filter((window) => window.endMinute > window.startMinute)
          .map((window) => ({
            start: localMinuteToInstant(date, window.startMinute, user.timezone),
            end: localMinuteToInstant(date, window.endMinute, user.timezone),
          }));
      }
    }

    const [calendarEvents, occurrences] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: { userId, isBusy: true, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
        select: { startsAt: true, endsAt: true },
      }),
      prisma.taskOccurrence.findMany({
        where: {
          userId,
          occurrenceDate: { lte: planDate },
          status: { in: ['PENDING', 'SCHEDULED'] },
          taskId: { notIn: blockers.map(({ blockedTaskId }) => blockedTaskId) },
          task: { status: { notIn: ['DONE', 'ARCHIVED', 'PAUSED'] } },
        },
        include: {
          task: {
            select: {
              title: true,
              priority: true,
              estimatedMinutes: true,
              firstStep: true,
            },
          },
        },
        orderBy: [{ dueAt: 'asc' }, { occurrenceDate: 'asc' }],
      }),
    ]);

    const protectedBlocks = currentPlan?.dailyBlocks ?? [];
    const protectedOccurrenceIds = new Set(
      protectedBlocks.flatMap((block) => (block.taskOccurrenceId ? [block.taskOccurrenceId] : []))
    );
    const eligibleOccurrences = occurrences.filter((occurrence) => {
      if (protectedOccurrenceIds.has(occurrence.id)) return false;
      const dueAt = occurrence.dueAt ?? occurrence.occurrenceDate;
      return dueAt < dayEnd;
    });
    const busy: TimeInterval[] = [
      ...calendarEvents.map(({ startsAt, endsAt }) => ({ start: startsAt, end: endsAt })),
      ...protectedBlocks.map(({ startsAt, endsAt }) => ({ start: startsAt, end: endsAt })),
    ];
    const schedule = scheduleCandidates({
      candidates: eligibleOccurrences.map((occurrence) => {
        const durationMinutes = occurrence.task.estimatedMinutes ?? 25;
        return {
          id: occurrence.id,
          title: occurrence.task.title,
          priority: occurrence.task.priority,
          tier: candidateTier(occurrence.task.priority, durationMinutes),
          dueAt: occurrence.dueAt ?? occurrence.occurrenceDate,
          durationMinutes,
        };
      }),
      availability,
      busy,
      profile,
    });

    return prisma.$transaction(async (transaction) => {
      const latestPlan = await transaction.dailyPlan.findFirst({
        where: { userId, planDate },
        orderBy: { version: 'desc' },
        select: { version: true },
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
      }));
      const plannedBlocks = schedule.scheduled.map((block, index) => {
        const occurrence = eligibleOccurrences.find(({ id }) => id === block.id);
        return {
          userId,
          title: block.title,
          brief: occurrence?.task.firstStep ?? null,
          taskOccurrenceId: block.id,
          startsAt: block.start,
          endsAt: block.end,
          durationMinutes: block.durationMinutes,
          status: 'PLANNED' as const,
          source: 'PLANNER' as const,
          position: copiedBlocks.length + index,
        };
      });
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
            candidateCount: eligibleOccurrences.length,
            scheduledCount: schedule.scheduled.length,
            unscheduled: schedule.unscheduled.map(({ candidate, reason }) => ({
              occurrenceId: candidate.id,
              reason,
            })),
            availability: availability.map(({ start, end }) => ({
              startsAt: start.toISOString(),
              endsAt: end.toISOString(),
            })),
          },
          dailyBlocks: { create: [...copiedBlocks, ...plannedBlocks] },
        },
        include: { dailyBlocks: { orderBy: { startsAt: 'asc' } } },
      });

      for (const block of schedule.scheduled) {
        await transaction.taskOccurrence.updateMany({
          where: { id: block.id, userId, status: { in: ['PENDING', 'SCHEDULED'] } },
          data: { status: 'SCHEDULED' },
        });
      }

      return plan;
    });
  },
};
