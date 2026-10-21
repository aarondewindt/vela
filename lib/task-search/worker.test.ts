/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: { $queryRaw: jest.fn(), taskIndexJob: { updateMany: jest.fn() } },
}));
jest.mock('./service', () => ({ taskCollection: { synchronize: jest.fn() } }));
import { prisma } from '@/lib/prisma';
import { taskCollection } from './service';
import { processNextTaskIndexJob, taskIndexRetryDelay } from './worker';
const job = { userId: 'owner', revision: 4, attempts: 2, leaseId: 'token' };
beforeEach(() => {
  jest.resetAllMocks();
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([job]);
  (prisma.taskIndexJob.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (taskCollection.synchronize as jest.Mock).mockResolvedValue({ indexed: 2, generated: 1 });
});
it('leaves an empty queue alone', async () => {
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
  expect(await processNextTaskIndexJob()).toEqual({ processed: false });
  expect(taskCollection.synchronize).not.toHaveBeenCalled();
});
it('synchronizes only the claimed owner and acknowledges only the claimed revision and lease', async () => {
  expect(await processNextTaskIndexJob()).toMatchObject({ succeeded: true, generated: 1 });
  expect(taskCollection.synchronize).toHaveBeenCalledWith('owner');
  expect(prisma.taskIndexJob.updateMany).toHaveBeenCalledWith({
    where: { userId: 'owner', leaseId: expect.any(String) },
    data: { completedRevision: 4, leaseId: null, leaseExpiresAt: null, lastError: null },
  });
});
it('retains pending work and safely backs off after model/configuration failures', async () => {
  (taskCollection.synchronize as jest.Mock).mockRejectedValue(
    new Error('private provider response')
  );
  expect(await processNextTaskIndexJob()).toEqual({ processed: true, succeeded: false });
  const { data } = (prisma.taskIndexJob.updateMany as jest.Mock).mock.calls[0][0];
  expect(data).not.toHaveProperty('completedRevision');
  expect(data.lastError).not.toContain('private');
  expect(data.runAfter.getTime()).toBeGreaterThan(Date.now() + 29_000);
  expect(taskIndexRetryDelay(100)).toBe(3_600_000);
});
it('surfaces storage failures so a supervisor can restart the worker', async () => {
  (prisma.$queryRaw as jest.Mock).mockRejectedValue(new Error('Storage offline'));
  await expect(processNextTaskIndexJob()).rejects.toThrow('Storage offline');
});
it('preserves a fresh retry schedule when an older in-flight revision fails', async () => {
  (taskCollection.synchronize as jest.Mock).mockRejectedValue(new Error('Provider failed'));
  (prisma.taskIndexJob.updateMany as jest.Mock)
    .mockResolvedValueOnce({ count: 0 })
    .mockResolvedValueOnce({ count: 1 });
  await processNextTaskIndexJob();
  expect(prisma.taskIndexJob.updateMany).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      where: { userId: 'owner', leaseId: expect.any(String), revision: 4 },
    })
  );
  expect(prisma.taskIndexJob.updateMany).toHaveBeenLastCalledWith({
    where: { userId: 'owner', leaseId: expect.any(String) },
    data: { leaseId: null, leaseExpiresAt: null },
  });
});
