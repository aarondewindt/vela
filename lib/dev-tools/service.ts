import { prisma } from '@/lib/prisma';

export const TEST_TASK_TAG = 'dev-tools-test';

type GenerateTestTasksInput = {
  count: number;
  priorityWeights: number[];
  sizeWeights: number[];
  noDueDatePercent: number;
  dueDateStartDays: number;
  dueDateEndDays: number;
  recurringPercent: number;
  recurringFrequency: 'DAILY' | 'WEEKLY';
  dependentPercent: number;
};

type ClearTestTasksInput = {
  createdFrom?: string;
  createdTo?: string;
};

const verbs = [
  'Review',
  'Update',
  'Document',
  'Improve',
  'Audit',
  'Prepare',
  'Refine',
  'Organize',
  'Test',
  'Plan',
  'Clean up',
  'Finalize',
];

const topics = [
  'the client onboarding flow',
  'the weekly planning routine',
  'the billing dashboard',
  'the project handoff checklist',
  'the support knowledge base',
  'the release notes process',
  'the team availability calendar',
  'the task reporting view',
  'the new user welcome email',
  'the data import workflow',
  'the meeting follow-up process',
  'the account settings screen',
  'the quarterly goals outline',
  'the recurring maintenance list',
  'the mobile navigation layout',
  'the quality review checklist',
  'the customer feedback summary',
  'the internal tools guide',
];

const contexts = [
  'for the next release',
  'before the team review',
  'with the latest feedback',
  'for the operations team',
  'ahead of the monthly check-in',
  'for the pilot group',
  'before the end of the sprint',
  'with the updated requirements',
  'for the current roadmap',
  'after the planning session',
  'for the next onboarding batch',
  'before the stakeholder demo',
];

function chooseWeightedValue(weights: number[]): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let point = Math.random() * total;
  for (let index = 0; index < weights.length; index += 1) {
    point -= weights[index];
    if (point < 0) {
      return index + 1;
    }
  }
  return weights.length;
}

function choose<T>(values: T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

function randomInteger(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function dateOffsetFromToday(offset: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
}

function makeCreatedAtFilter(input: ClearTestTasksInput) {
  if (!input.createdFrom || !input.createdTo) {
    return undefined;
  }

  const endExclusive = new Date(`${input.createdTo}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  return {
    gte: new Date(`${input.createdFrom}T00:00:00.000Z`),
    lt: endExclusive,
  };
}

export const devToolsService = {
  async listTestTasks(userId: string) {
    const where = { userId, tags: { has: TEST_TASK_TAG } };
    const [count, tasks] = await prisma.$transaction([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          priority: true,
          size: true,
          dueDate: true,
          isRecurring: true,
          recurrenceRule: true,
          createdAt: true,
          dependenciesBlocking: { select: { id: true } },
        },
      }),
    ]);

    return {
      count,
      tasks: tasks.map(({ dependenciesBlocking, ...task }) => ({
        ...task,
        dependencyCount: dependenciesBlocking.length,
      })),
    };
  },

  async generateTestTasks(userId: string, input: GenerateTestTasksInput) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });

    return prisma.$transaction(async (tx) => {
      const taskRows = Array.from({ length: input.count }, () => {
        const size = chooseWeightedValue(input.sizeWeights);
        const recurring = Math.random() * 100 < input.recurringPercent;
        const hasDueDate = Math.random() * 100 >= input.noDueDatePercent;
        const dueDateOffset = randomInteger(input.dueDateStartDays, input.dueDateEndDays);
        const title = `${choose(verbs)} ${choose(topics)} ${choose(contexts)}`;

        return {
          data: {
            userId,
            title,
            brief: `A small piece of work to ${title.toLowerCase()}. Confirm the expected outcome, make the change, and note anything that should follow.`,
            priority: chooseWeightedValue(input.priorityWeights),
            size,
            estimatedMinutes: size * 45,
            status: 'BACKLOG' as const,
            dueDate: hasDueDate ? dateOffsetFromToday(dueDateOffset) : null,
            tags: [TEST_TASK_TAG],
            isRecurring: recurring,
            recurrenceRule: recurring ? `RRULE:FREQ=${input.recurringFrequency};INTERVAL=1` : null,
            recurrenceTz: recurring ? user.timezone : null,
          },
        };
      });

      const createdTasks = await tx.task.createManyAndReturn({
        data: taskRows.map(({ data }) => data),
        select: { id: true },
      });

      const dependencies = createdTasks.flatMap((task, index) => {
        if (index === 0 || Math.random() * 100 >= input.dependentPercent) {
          return [];
        }
        const prerequisite = createdTasks[randomInteger(0, index - 1)];
        return [
          {
            userId,
            blockedTaskId: task.id,
            dependsOnTaskId: prerequisite.id,
            isHardBlock: true,
          },
        ];
      });

      if (dependencies.length > 0) {
        await tx.taskDependency.createMany({ data: dependencies });
      }

      return { count: createdTasks.length, dependencyCount: dependencies.length };
    });
  },

  async clearTestTasks(userId: string, input: ClearTestTasksInput) {
    const tasks = await prisma.task.findMany({
      where: {
        userId,
        tags: { has: TEST_TASK_TAG },
        ...(input.createdFrom && input.createdTo ? { createdAt: makeCreatedAtFilter(input) } : {}),
      },
      select: { id: true },
    });

    if (tasks.length === 0) {
      return { count: 0 };
    }

    const taskIds = tasks.map(({ id }) => id);

    return prisma.$transaction(async (tx) => {
      const occurrences = await tx.taskOccurrence.findMany({
        where: { userId, taskId: { in: taskIds } },
        select: { id: true },
      });
      const occurrenceIds = occurrences.map(({ id }) => id);
      const blocks =
        occurrenceIds.length > 0
          ? await tx.dailyBlock.findMany({
              where: { userId, taskOccurrenceId: { in: occurrenceIds } },
              select: { id: true },
            })
          : [];
      const blockIds = blocks.map(({ id }) => id);

      if (occurrenceIds.length > 0 || blockIds.length > 0) {
        await tx.checkin.deleteMany({
          where: {
            userId,
            OR: [
              ...(occurrenceIds.length > 0 ? [{ taskOccurrenceId: { in: occurrenceIds } }] : []),
              ...(blockIds.length > 0 ? [{ blockId: { in: blockIds } }] : []),
            ],
          },
        });
      }
      if (blockIds.length > 0) {
        await tx.dailyBlock.deleteMany({ where: { userId, id: { in: blockIds } } });
      }
      if (occurrenceIds.length > 0) {
        await tx.taskOccurrence.deleteMany({ where: { userId, id: { in: occurrenceIds } } });
      }

      await tx.taskDependency.deleteMany({
        where: {
          userId,
          OR: [{ blockedTaskId: { in: taskIds } }, { dependsOnTaskId: { in: taskIds } }],
        },
      });
      const deleted = await tx.task.deleteMany({ where: { userId, id: { in: taskIds } } });
      return { count: deleted.count };
    });
  },
};
