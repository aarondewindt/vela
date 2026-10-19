jest.mock('superjson', () => ({ serialize: (v: unknown) => v, deserialize: (v: unknown) => v }));
jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('./service', () => ({
  taskReviewService: { latest: jest.fn(), generate: jest.fn(), accept: jest.fn() },
}));
import { taskReviewRouter } from './router';
import { taskReviewService } from './service';
const taskId = '00000000-0000-4000-8000-000000000001';
it('authenticates every operation before accessing review data', async () => {
  const caller = taskReviewRouter.createCaller({ userId: null });
  await expect(caller.latest({ taskId })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  await expect(caller.generate({ taskId })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  await expect(caller.accept({ id: taskId, fields: ['size'] })).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  expect(taskReviewService.latest).not.toHaveBeenCalled();
});
it('validates inputs and delegates using the authenticated owner', async () => {
  const caller = taskReviewRouter.createCaller({ userId: 'owner' });
  await expect(caller.generate({ taskId: 'bad' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  await expect(caller.accept({ id: taskId, fields: [] })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  await caller.generate({ taskId });
  expect(taskReviewService.generate).toHaveBeenCalledWith('owner', { taskId });
});
