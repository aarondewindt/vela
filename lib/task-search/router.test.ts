/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('superjson', () => ({
  serialize: (value: unknown) => value,
  deserialize: (value: unknown) => value,
}));
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('@/lib/ai', () => jest.requireActual('@/lib/ai/errors'));
jest.mock('./service', () => ({
  taskSearchService: {
    status: jest.fn(),
    models: jest.fn(),
    synchronize: jest.fn(),
    rebuild: jest.fn(),
    search: jest.fn(),
  },
}));
import { taskSearchRouter } from './router';
import { taskSearchService } from './service';
import { TRPCError } from '@trpc/server';
const input = {
  selection: { provider: 'ollama' as const, modelId: 'embed' },
  queryInstruction: '',
};
beforeEach(() => jest.resetAllMocks());
it('authenticates every endpoint', async () => {
  const caller = taskSearchRouter.createCaller({ userId: null });
  for (const operation of [
    () => caller.status(),
    () => caller.models(),
    () => caller.index(),
    () => caller.rebuild(input),
    () => caller.search({ query: 'test' }),
  ]) {
    await expect(operation()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  }
  Object.values(taskSearchService).forEach((method) => expect(method).not.toHaveBeenCalled());
});
it('takes owner identity only from the authenticated session', async () => {
  const caller = taskSearchRouter.createCaller({ userId: 'user-a' });
  await caller.status();
  await caller.index();
  await caller.search({ query: 'test' });
  await caller.rebuild(input);
  expect(taskSearchService.status).toHaveBeenCalledWith('user-a');
  expect(taskSearchService.synchronize).toHaveBeenCalledWith('user-a');
  expect(taskSearchService.search).toHaveBeenCalledWith('user-a', 'test', 10);
  expect(taskSearchService.rebuild).toHaveBeenCalledWith('user-a', input.selection, '');
});
it('enforces input limits before expensive work', async () => {
  const caller = taskSearchRouter.createCaller({ userId: 'user-a' });
  await expect(caller.search({ query: '  ' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  await expect(caller.search({ query: 'test', limit: 100 })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  expect(taskSearchService.search).not.toHaveBeenCalled();
});
it('preserves maintainer denial and masks unexpected errors', async () => {
  const caller = taskSearchRouter.createCaller({ userId: 'user-a' });
  (taskSearchService.rebuild as jest.Mock).mockRejectedValue(new TRPCError({ code: 'FORBIDDEN' }));
  await expect(caller.rebuild(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  (taskSearchService.search as jest.Mock).mockRejectedValue(new Error('private SQL'));
  await expect(caller.search({ query: 'test' })).rejects.toMatchObject({
    message: 'Task search is temporarily unavailable. Please retry.',
  });
});
