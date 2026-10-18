/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: { $queryRaw: jest.fn(), nutritionProductIndexJob: { updateMany: jest.fn() } },
}));
jest.mock('./product-index', () => ({ productCollection: { synchronize: jest.fn() } }));
import { prisma } from '@/lib/prisma';
import { productCollection } from './product-index';
import { processNextProductIndexJob, productIndexRetryDelay } from './product-index-worker';
const job = { userId: 'owner', revision: 4, attempts: 2, leaseId: 'token' };
beforeEach(() => {
  jest.resetAllMocks();
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([job]);
  (prisma.nutritionProductIndexJob.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (productCollection.synchronize as jest.Mock).mockResolvedValue({ indexed: 2, generated: 1 });
});
it('leaves an empty queue alone', async () => {
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
  expect(await processNextProductIndexJob()).toEqual({ processed: false });
  expect(productCollection.synchronize).not.toHaveBeenCalled();
});
it('synchronizes only the claimed owner and acknowledges only the claimed revision and lease', async () => {
  expect(await processNextProductIndexJob()).toMatchObject({ succeeded: true, generated: 1 });
  expect(productCollection.synchronize).toHaveBeenCalledWith('owner');
  expect(prisma.nutritionProductIndexJob.updateMany).toHaveBeenCalledWith({
    where: { userId: 'owner', leaseId: expect.any(String) },
    data: { completedRevision: 4, leaseId: null, leaseExpiresAt: null, lastError: null },
  });
});
it('retains pending work and safely backs off after model/configuration failures', async () => {
  (productCollection.synchronize as jest.Mock).mockRejectedValue(
    new Error('private provider response')
  );
  expect(await processNextProductIndexJob()).toEqual({ processed: true, succeeded: false });
  const { data } = (prisma.nutritionProductIndexJob.updateMany as jest.Mock).mock.calls[0][0];
  expect(data).not.toHaveProperty('completedRevision');
  expect(data.lastError).not.toContain('private');
  expect(data.runAfter.getTime()).toBeGreaterThan(Date.now() + 29_000);
  expect(productIndexRetryDelay(100)).toBe(3_600_000);
});
it('surfaces storage failures so a supervisor can restart the worker', async () => {
  (prisma.$queryRaw as jest.Mock).mockRejectedValue(new Error('Storage offline'));
  await expect(processNextProductIndexJob()).rejects.toThrow('Storage offline');
});
it('preserves a fresh retry schedule when an older in-flight revision fails', async () => {
  (productCollection.synchronize as jest.Mock).mockRejectedValue(new Error('Provider failed'));
  (prisma.nutritionProductIndexJob.updateMany as jest.Mock)
    .mockResolvedValueOnce({ count: 0 })
    .mockResolvedValueOnce({ count: 1 });
  await processNextProductIndexJob();
  expect(prisma.nutritionProductIndexJob.updateMany).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      where: { userId: 'owner', leaseId: expect.any(String), revision: 4 },
    })
  );
  expect(prisma.nutritionProductIndexJob.updateMany).toHaveBeenLastCalledWith({
    where: { userId: 'owner', leaseId: expect.any(String) },
    data: { leaseId: null, leaseExpiresAt: null },
  });
});
