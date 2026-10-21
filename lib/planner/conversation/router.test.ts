jest.mock('server-only', () => ({}));
jest.mock('superjson', () => ({ serialize: (v: unknown) => v, deserialize: (v: unknown) => v }));
jest.mock('@/lib/auth', () => ({ auth: {} }));
jest.mock('./service', () => ({
  conversationService: {
    create: jest.fn(),
    get: jest.fn(),
    send: jest.fn(),
    accept: jest.fn(),
    discard: jest.fn(),
  },
}));
import { conversationRouter } from './router';
import { conversationService } from './service';
const id = '00000000-0000-4000-8000-000000000001';
it('requires authentication for conversation writes and acceptance', async () => {
  const caller = conversationRouter.createCaller({ userId: null });
  await expect(caller.create()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  await expect(caller.accept({ conversationId: id, turnId: id })).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  expect(conversationService.create).not.toHaveBeenCalled();
  expect(conversationService.accept).not.toHaveBeenCalled();
});
it('validates date, text, revisions and IDs before owner-scoped delegation', async () => {
  const caller = conversationRouter.createCaller({ userId: 'owner' });
  const input = {
    conversationId: id,
    requestId: id,
    date: '2026-10-20',
    text: 'Create a task',
    revision: 0,
  };
  await expect(caller.send({ ...input, date: '2026-02-30' })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  await expect(caller.send({ ...input, text: ' ' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  await expect(caller.send({ ...input, revision: -1 })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  await expect(caller.send({ ...input, text: 'x'.repeat(2001) })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  expect(conversationService.send).not.toHaveBeenCalled();
  await caller.send(input);
  expect(conversationService.send).toHaveBeenCalledWith('owner', input);
});
