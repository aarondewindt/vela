import 'server-only';

import { prisma } from '@/lib/prisma';
export const plannerService = {
  listTasks(userId: string) {
    return prisma.task.findMany({
      where: { userId },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });
  },

  createTask(userId: string, input: { title: string; brief?: string }) {
    return prisma.task.create({
      data: {
        userId,
        title: input.title,
        brief: input.brief,
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
        },
      },
    });
  },
};
