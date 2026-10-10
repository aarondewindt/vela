import { prisma } from '@/lib/prisma';
import { planningCategories, type PlanningCategoryValue } from '@/lib/planner/tasks';

export const TEST_TASK_TAG = 'dev-tools-test';

type GenerateTestTasksInput = {
  count: number;
  priorityWeights: number[];
  sizeWeights: number[];
  categoryWeights: number[];
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

const categoryContent: Record<
  PlanningCategoryValue,
  { verbs: string[]; topics: string[]; contexts: string[] }
> = {
  WORK: {
    verbs: [
      'Review',
      'Update',
      'Map',
      'Fix',
      'Audit',
      'Draft',
      'Polish',
      'Organize',
      'Test',
      'Ship',
      'Plan',
      'Check',
      'Simplify',
      'Build',
      'Schedule',
      'Compare',
      'Align',
      'Measure',
      'Refresh',
      'Verify',
      'Outline',
    ],
    topics: [
      'onboarding flow',
      'weekly plan',
      'billing dashboard',
      'handoff checklist',
      'support guide',
      'release notes',
      'availability calendar',
      'task reports',
      'welcome email',
      'data import',
      'meeting follow-up',
      'account settings',
      'quarterly goals',
      'maintenance list',
      'mobile navigation',
      'quality checklist',
      'customer feedback',
      'internal tools',
      'project brief',
      'team backlog',
      'project timeline',
      'team dashboard',
    ],
    contexts: [
      'for launch',
      'before review',
      'with feedback',
      'for the team',
      'this sprint',
      'for the roadmap',
      'after planning',
      'for onboarding',
      'before the demo',
      'with new specs',
      'for Q4',
      'before handoff',
    ],
  },
  LIFE: {
    verbs: [
      'Plan',
      'Organize',
      'Fix',
      'Update',
      'Check',
      'Schedule',
      'Prepare',
      'Review',
      'Clean up',
      'Track',
      'Replace',
      'Sort',
      'Arrange',
      'Set up',
      'Gather',
      'Refresh',
    ],
    topics: [
      'personal budget',
      'home repairs',
      'meal plan',
      'fitness routine',
      'garden layout',
      'desk setup',
      'sleep routine',
      'focus routine',
      'weekly errands',
      'family calendar',
      'health checkup',
      'home inventory',
    ],
    contexts: [
      'for home',
      'before Monday',
      'with the family',
      'this month',
      'for next week',
      'before the appointment',
      'after work',
      'for the new house',
    ],
  },
  LEISURE: {
    verbs: [
      'Explore',
      'Plan',
      'Book',
      'Learn',
      'Practice',
      'Collect',
      'Sketch',
      'Share',
      'Visit',
      'Try',
      'Arrange',
      'Choose',
      'Discover',
      'Capture',
      'Create',
      'Pick',
    ],
    topics: [
      'reading list',
      'travel itinerary',
      'learning notes',
      'photo archive',
      'volunteer shift',
      'gift list',
      'weekend plans',
      'hobby project',
      'concert plans',
      'camping checklist',
      'museum visit',
      'playlist',
    ],
    contexts: [
      'for vacation',
      'for the weekend',
      'for the trip',
      'with friends',
      'for the festival',
      'this summer',
      'for the next meetup',
      'before booking',
    ],
  },
  REST: {
    verbs: [
      'Pause',
      'Unplug',
      'Recover',
      'Rest',
      'Reflect',
      'Breathe',
      'Stretch',
      'Recharge',
      'Protect',
      'Simplify',
      'Prepare',
      'Slow down',
      'Reset',
      'Make time for',
    ],
    topics: [
      'evening routine',
      'quiet time',
      'recovery plan',
      'screen break',
      'sleep schedule',
      'slow morning',
      'meditation space',
      'low-energy day',
      'rest day',
      'wind-down routine',
      'time-off plan',
      'breathing practice',
    ],
    contexts: [
      'after a busy week',
      'for tonight',
      'before bed',
      'on Sunday',
      'after travel',
      'for a quiet day',
      'between projects',
      'this evening',
    ],
  },
};

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
          category: true,
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
        const category = planningCategories[chooseWeightedValue(input.categoryWeights) - 1];
        const content = categoryContent[category];
        const title = `${choose(content.verbs)} ${choose(content.topics)}${Math.random() < 0.45 ? ` ${choose(content.contexts)}` : ''}`;

        return {
          data: {
            userId,
            title,
            category,
            brief: `A small piece of work to ${title.toLowerCase()}. Confirm the expected outcome, make the change, and note anything that should follow.`,
            priority: chooseWeightedValue(input.priorityWeights),
            size,
            estimatedMinutes: size * 15,
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
