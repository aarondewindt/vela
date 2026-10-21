/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({ prisma: { $transaction: jest.fn() } }));
jest.mock('./snapshot', () => ({
  ...jest.requireActual('./snapshot'),
  loadSnapshot: jest.fn(),
}));
import { prisma } from '@/lib/prisma';
import { loadSnapshot, fingerprint } from './snapshot';
import { proposalService } from './service';
import { progressFixture } from './replan-fixtures';
import { at, date, taskId } from '../generation/fixtures';
import type { ReplanInput } from './schema';

const input: ReplanInput = {
  requestId: taskId(99),
  date,
  baseHash: 'a'.repeat(64),
  action: 'finish',
  blockId: taskId(20),
  endTime: '09:20',
  completeTask: false,
  pullForward: false,
  explanation: 'Finished segment',
};
let s = progressFixture();
const tx = {
  $executeRaw: jest.fn(),
  planningProposal: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  dailyBlock: { update: jest.fn(), count: jest.fn(), create: jest.fn() },
  task: { update: jest.fn(), updateMany: jest.fn() },
  taskOccurrence: { update: jest.fn(), updateMany: jest.fn() },
  dailyPlan: { update: jest.fn() },
};
beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers().setSystemTime(at('09:30'));
  s = progressFixture();
  jest.mocked(loadSnapshot).mockResolvedValue(s);
  jest.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(tx));
  tx.planningProposal.create.mockResolvedValue({ id: taskId(100) });
  tx.dailyBlock.count.mockResolvedValue(0);
  tx.taskOccurrence.update.mockResolvedValue({ taskId: taskId(1) });
});
afterEach(() => jest.useRealTimers());
async function preview(raw = input) {
  const result = await proposalService.replan('owner', raw);
  const data = tx.planningProposal.create.mock.calls[0][0].data;
  tx.planningProposal.findFirst.mockResolvedValue({ ...data, id: result.id, status: 'PENDING' });
  return { result, data };
}
it('saves a replayable preview without progress writes and rejects changed retry payloads', async () => {
  const { result, data } = await preview();
  expect(tx.dailyBlock.update).not.toHaveBeenCalled();
  expect(tx.task.update).not.toHaveBeenCalled();
  tx.planningProposal.findUnique.mockResolvedValue({ id: result.id, document: data.document });
  jest.mocked(loadSnapshot).mockRejectedValue(new Error('Inputs unavailable'));
  expect(await proposalService.replan('owner', input)).toEqual(result);
  await expect(
    proposalService.replan('owner', { ...input, completeTask: true })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('records actual effort on acceptance without completing the task and leaves its occurrence open', async () => {
  const { result } = await preview();
  tx.dailyBlock.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
  const receipt = await proposalService.accept('owner', result.id);
  expect(receipt.changedBlockIds).toEqual([taskId(20)]);
  expect(tx.dailyBlock.update).toHaveBeenCalledWith({
    where: { id: taskId(20) },
    data: {
      startsAt: at('09:00'),
      endsAt: at('09:20'),
      durationMinutes: 20,
      status: 'DONE',
      completedAt: at('09:20'),
    },
  });
  expect(tx.taskOccurrence.update).toHaveBeenCalledWith({
    where: { id: taskId(10) },
    data: { status: 'PENDING' },
  });
  expect(tx.task.update).not.toHaveBeenCalled();
  expect(tx.task.updateMany).not.toHaveBeenCalled();
  expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  expect(tx.planningProposal.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: 'APPLIED' }) })
  );
});
it('completes underlying work only when requested, and recurring completion is occurrence scoped', async () => {
  s.tasks[0].isRecurring = true;
  const { result } = await preview({ ...input, completeTask: true });
  await proposalService.accept('owner', result.id);
  expect(tx.taskOccurrence.update).toHaveBeenCalledWith({
    where: { id: taskId(10), userId: 'owner' },
    data: { status: 'DONE', completedAt: at('09:20') },
  });
  expect(tx.task.update).not.toHaveBeenCalled();
  expect(tx.taskOccurrence.updateMany).not.toHaveBeenCalled();
});
it('completes a nonrecurring task only through explicit acceptance', async () => {
  const { result } = await preview({ ...input, completeTask: true });
  expect(tx.task.update).not.toHaveBeenCalled();
  await proposalService.accept('owner', result.id);
  expect(tx.task.update).toHaveBeenCalledWith({
    where: { id: taskId(1), userId: 'owner' },
    data: { status: 'DONE' },
  });
});
it('saves the increased total estimate in the same acceptance transaction as the extension', async () => {
  const { result, data } = await preview({
    ...input,
    action: 'extend',
    endTime: '10:30',
    estimatedMinutes: 90,
  });
  expect(data.preview.taskChanges).toContainEqual({
    taskId: taskId(1),
    title: 'Task 1',
    estimatedMinutes: 90,
  });
  expect(tx.task.update).not.toHaveBeenCalled();
  await proposalService.accept('owner', result.id);
  expect(tx.task.update).toHaveBeenCalledWith({
    where: { id: taskId(1), userId: 'owner' },
    data: { estimatedMinutes: 90 },
  });
});
it('rejects stale snapshots before any writes and hides foreign proposals', async () => {
  const { result } = await preview();
  s.hash = fingerprint('changed');
  await expect(proposalService.accept('owner', result.id)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  expect(tx.dailyBlock.update).not.toHaveBeenCalled();
  tx.planningProposal.findFirst.mockResolvedValue(null);
  await expect(proposalService.accept('foreign', result.id)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  expect(tx.planningProposal.findFirst).toHaveBeenLastCalledWith({
    where: { id: result.id, userId: 'foreign' },
  });
});
it('replays an applied receipt without reapplying progress', async () => {
  const receipt = {
    planId: taskId(90),
    changedBlockIds: [taskId(20)],
    addedBlockIds: [],
    appliedAt: at('09:30').toISOString(),
  };
  tx.planningProposal.findFirst.mockResolvedValue({ status: 'APPLIED', receipt });
  expect(await proposalService.accept('owner', taskId(100))).toEqual(receipt);
  expect(loadSnapshot).not.toHaveBeenCalled();
  expect(tx.dailyBlock.update).not.toHaveBeenCalled();
});

it('persists a scheduled meal without a task occurrence and protects explicit edits on acceptance', async () => {
  s.blocks[1].mealKind = 'LUNCH';
  s.blocks[1].taskOccurrenceId = null;
  s.blocks[1].category = 'REST';
  s.blocks[1].title = 'Lunch';
  const document = {
    schemaVersion: 1,
    operations: [
      {
        type: 'move',
        explicit: true,
        blockId: s.blocks[1].id,
        startsAt: at('12:00').toISOString(),
        endsAt: at('12:30').toISOString(),
        explanation: 'Lunch later',
      },
    ],
  };
  const input = { requestId: taskId(99), date, baseHash: s.hash, document };
  const result = await proposalService.create(
    'owner',
    input as Parameters<typeof proposalService.create>[1]
  );
  const data = tx.planningProposal.create.mock.calls[0][0].data;
  tx.planningProposal.findFirst.mockResolvedValue({ ...data, id: result.id, status: 'PENDING' });
  await proposalService.accept('owner', result.id);
  expect(tx.dailyBlock.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: s.blocks[1].id },
      data: expect.objectContaining({ isFixed: true, startsAt: at('12:00') }),
    })
  );
  expect(tx.taskOccurrence.update).not.toHaveBeenCalled();
});
