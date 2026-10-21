import 'server-only';
import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@/generated/prisma/client';
import { blockNoteText } from '@/lib/task-search/text';

export function sourceHash(source: unknown) {
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}

const taskSelect = {
  id: true,
  title: true,
  brief: true,
  content: true,
  firstStep: true,
  status: true,
  priority: true,
  size: true,
  estimatedMinutes: true,
  dueDate: true,
  tags: true,
  category: true,
  earliestStartAt: true,
  isRecurring: true,
  recurrenceRule: true,
  recurrenceAnchorDate: true,
  recurrenceTz: true,
  leadTimeDays: true,
  updatedAt: true,
  themeId: true,
} satisfies Prisma.TaskSelect;

/** Complete bounded context: refuse oversized histories rather than silently omitting progress. */
export async function loadReviewSource(
  db: Prisma.TransactionClient,
  userId: string,
  taskId: string,
  now = new Date()
) {
  const task = await db.task.findFirst({
    where: { id: taskId, userId },
    select: {
      ...taskSelect,
      theme: {
        select: {
          id: true,
          userId: true,
          name: true,
          brief: true,
          content: true,
          category: true,
          isActive: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!task) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found.' });
  }
  const [user, dependencies, occurrences, blocks, checkins, availableThemes] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } }),
    db.taskDependency.findMany({
      where: { userId, OR: [{ blockedTaskId: taskId }, { dependsOnTaskId: taskId }] },
      orderBy: { id: 'asc' },
      take: 101,
      select: {
        id: true,
        dependencyType: true,
        isHardBlock: true,
        createdAt: true,
        blockedTask: { select: { ...taskSelect, userId: true } },
        dependsOnTask: { select: { ...taskSelect, userId: true } },
      },
    }),
    db.taskOccurrence.findMany({ where: { userId, taskId }, orderBy: { id: 'asc' }, take: 201 }),
    db.dailyBlock.findMany({
      where: { userId, taskOccurrence: { userId, taskId } },
      orderBy: { id: 'asc' },
      take: 201,
      select: {
        id: true,
        taskOccurrenceId: true,
        title: true,
        brief: true,
        content: true,
        startsAt: true,
        endsAt: true,
        durationMinutes: true,
        status: true,
        completedAt: true,
        updatedAt: true,
      },
    }),
    db.checkin.findMany({
      where: {
        userId,
        OR: [
          { taskOccurrence: { userId, taskId } },
          { block: { userId, taskOccurrence: { userId, taskId } } },
        ],
      },
      orderBy: { id: 'asc' },
      take: 201,
      select: {
        id: true,
        checkinAt: true,
        energyLevel: true,
        focusLevel: true,
        moodLevel: true,
        brief: true,
        content: true,
        commandText: true,
        applied: true,
      },
    }),
    db.theme.findMany({
      where: { userId, isActive: true },
      orderBy: { id: 'asc' },
      take: 101,
      select: { id: true, name: true, brief: true, category: true, updatedAt: true },
    }),
  ]);
  if (
    availableThemes.length > 100 ||
    dependencies.length > 100 ||
    [occurrences, blocks, checkins].some((rows) => rows.length > 200)
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This task has too much history for a complete AI review.',
    });
  }
  const withNotes = <T extends { content: unknown }>(row: T) => {
    const { content, ...rest } = row;
    return { ...rest, notes: blockNoteText(content), contentHash: sourceHash(content) };
  };
  const source = {
    version: 2,
    availableThemes,
    asOfDate: new Intl.DateTimeFormat('en-CA', { timeZone: user.timezone }).format(now),
    timezone: user.timezone,
    task: withNotes({ ...task, theme: undefined }),
    theme: task.theme?.userId === userId ? withNotes(task.theme) : null,
    dependencies: dependencies
      .filter((d) => d.blockedTask.userId === userId && d.dependsOnTask.userId === userId)
      .map((d) => ({
        ...d,
        blockedTask: withNotes(d.blockedTask),
        dependsOnTask: withNotes(d.dependsOnTask),
      })),
    occurrences,
    blocks: blocks.map(withNotes),
    checkins: checkins.map(withNotes),
  };
  if (JSON.stringify(source).length > 50000) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This task context is too large for a complete AI review.',
    });
  }
  return { source, hash: sourceHash(source) };
}
