/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: { $transaction: jest.fn(), task: { findMany: jest.fn() } },
}));
jest.mock('./service', () => ({ taskCollection: { status: jest.fn(), search: jest.fn() } }));
import { prisma } from '@/lib/prisma';
import { taskCollection } from './service';
import { retrievePlanningTasks } from './retrieval';
import { fixture, date, at, taskId } from '@/lib/planner/generation/fixtures';
import { AiError } from '@/lib/ai/errors';

let s = fixture();
const input = { query: 'housework', date, limit: 1, semantic: true };
beforeEach(() => {
  jest.resetAllMocks();
  s = fixture([30, 30, 30, 30, 30]);
  s.tasks.forEach((t) => {
    t.updatedAt = at('00:00');
  });
  (prisma.$transaction as jest.Mock).mockImplementation(async () => s);
  (prisma.task.findMany as jest.Mock).mockImplementation(async () => s.tasks);
  (taskCollection.status as jest.Mock).mockResolvedValue({ pending: 2 });
  (taskCollection.search as jest.Mock).mockResolvedValue({ results: [{ id: taskId(2) }] });
});
it('shares owner/date scoped eligibility with scheduling and filters before semantic top-k', async () => {
  s.tasks[2].status = 'ARCHIVED';
  s.tasks[3].status = 'DONE';
  s.tasks[4].earliestStartAt = new Date('2031-01-01');
  const result = await retrievePlanningTasks('owner', input);
  expect(taskCollection.search).toHaveBeenCalledWith(
    'owner',
    input.query,
    1,
    expect.any(AbortSignal),
    [taskId(1), taskId(2)]
  );
  expect(prisma.task.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ userId: 'owner' }) })
  );
  expect(result.ids).toEqual([taskId(2)]);
  expect(result.warnings.join()).toMatch(/2 pending/);
});
it.each(['brief', 'firstStep', 'tags', 'content'] as const)(
  'searches current %s without embeddings',
  async (field) => {
    Object.assign(s.tasks[0], {
      [field]:
        field === 'tags'
          ? ['housework']
          : field === 'content'
            ? [{ content: [{ text: 'housework' }] }]
            : 'housework',
    });
    const result = await retrievePlanningTasks('owner', { ...input, semantic: false }, s);
    expect(result.ids).toEqual([taskId(1)]);
    expect(taskCollection.search).not.toHaveBeenCalled();
  }
);
it('keeps all important candidates outside match limits while preferring conventional matches', async () => {
  s.tasks[0].brief = 'housework';
  s.tasks[3].priority = 1;
  s.tasks[4].dueDate = new Date(date);
  const result = await retrievePlanningTasks('owner', input, s);
  expect(result.ids).toEqual([taskId(1)]);
  expect(
    result.candidates
      .slice(0, 2)
      .map((c) => c.taskId)
      .sort()
  ).toEqual([taskId(4), taskId(5)]);
  expect(result.candidates[2].taskId).toBe(taskId(1));
  expect(result.candidates).toHaveLength(5);
});
it('rejects mismatched snapshot owners before searching', async () => {
  await expect(retrievePlanningTasks('intruder', input, s)).rejects.toThrow(/owner and date/);
  expect(taskCollection.search).not.toHaveBeenCalled();
});
it.each(['changed', 'deleted', 'foreign'] as const)(
  'excludes %s semantic results after inference',
  async (kind) => {
    (prisma.task.findMany as jest.Mock).mockResolvedValue(
      kind === 'changed' ? [{ id: taskId(2), updatedAt: at('01:00') }] : []
    );
    expect((await retrievePlanningTasks('owner', input, s)).ids).toEqual([]);
  }
);
it('uses conventional matches on an unavailable model, but surfaces database failures', async () => {
  s.tasks[0].firstStep = 'housework';
  (taskCollection.search as jest.Mock).mockRejectedValue(
    new AiError('PROVIDER_UNAVAILABLE', 'Unavailable')
  );
  expect(await retrievePlanningTasks('owner', input, s)).toMatchObject({
    ids: [taskId(1)],
    semantic: 'unavailable',
  });
  (taskCollection.status as jest.Mock).mockRejectedValue(new Error('Storage failed'));
  await expect(retrievePlanningTasks('owner', input, s)).rejects.toThrow('Storage failed');
});
it('excludes tasks with hard prerequisites and fully allocated work', async () => {
  s.dependencies = [
    {
      blockedTaskId: taskId(1),
      dependsOnTaskId: taskId(2),
      isHardBlock: true,
      dependsOnTask: { userId: 'owner', status: 'BACKLOG' },
    },
  ] as typeof s.dependencies;
  s.tasks[2].estimatedMinutes = 0;
  const result = await retrievePlanningTasks('owner', { ...input, semantic: false }, s);
  expect(result.candidates.map((c) => c.taskId)).not.toContain(taskId(1));
  expect(result.candidates.map((c) => c.taskId)).not.toContain(taskId(3));
});
it('does not resurrect closed recurring occurrences or accept unsupported recurrence', async () => {
  Object.assign(s.tasks[0], { isRecurring: true, recurrenceRule: 'FREQ=DAILY' });
  Object.assign(s.tasks[1], { isRecurring: true, recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU' });
  Object.assign(s.tasks[2], { isRecurring: true, recurrenceRule: 'FREQ=HOURLY' });
  s.occurrences = [
    { id: taskId(90), taskId: taskId(1), occurrenceDate: new Date(date), status: 'DONE' },
  ] as typeof s.occurrences;
  const result = await retrievePlanningTasks('owner', { ...input, semantic: false }, s);
  expect(result.candidates.map((c) => c.taskId)).toEqual([taskId(4), taskId(5)]);
});
it('excludes fully allocated work and exposes only remaining effort', async () => {
  s.occurrences = [1, 2].map((id) => ({
    id: taskId(id + 80),
    taskId: taskId(id),
    occurrenceDate: new Date(date),
    status: 'SCHEDULED',
  })) as typeof s.occurrences;
  s.blocks = [1, 2].map((id) => ({
    taskOccurrenceId: taskId(id + 80),
    status: 'PLANNED',
    durationMinutes: id === 1 ? 30 : 10,
  })) as typeof s.blocks;
  const result = await retrievePlanningTasks('owner', { ...input, semantic: false }, s);
  expect(result.candidates.map((c) => c.taskId)).not.toContain(taskId(1));
  expect(result.candidates.find((c) => c.taskId === taskId(2))?.remaining).toBe(20);
});
