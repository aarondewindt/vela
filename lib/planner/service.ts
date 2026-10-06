import 'server-only';

import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '../../generated/prisma/client';
import type { TaskRow } from './tasks';
import type { ViewConfig } from '@/lib/views/types';

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

async function assertOwnsTheme(userId: string, themeId: string | null | undefined) {
  if (!themeId) {
    return;
  }
  const theme = await prisma.theme.findFirst({ where: { id: themeId, userId }, select: { id: true } });
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
};
