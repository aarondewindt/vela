/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('superjson', () => ({ serialize: (v: unknown) => v, deserialize: (v: unknown) => v }));
jest.mock('@/lib/auth', () => ({ auth: {} }));
jest.mock('@/lib/ai-dev/errors', () => ({ getAiDevError: jest.fn() }));
jest.mock('@/lib/ai-dev/service', () => ({ aiDevService: {} }));
jest.mock('./service', () => ({ plannerChatConversations: {} }));
jest.mock('./records', () => ({
  workspaceRecords: { pending: jest.fn(), get: jest.fn(), resolve: jest.fn() },
}));
import { plannerChatRouter } from './router';
import { workspaceRecords } from './records';
const id = '00000000-0000-4000-8000-000000000001';
it('requires authentication for record reads and resolution', async () => {
  const caller = plannerChatRouter.createCaller({ userId: null });
  await expect(caller.getRecordPreview({ conversationId: id, id })).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  await expect(
    caller.resolveRecordPreview({ conversationId: id, id, action: 'accept' })
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  expect(workspaceRecords.resolve).not.toHaveBeenCalled();
});
it('validates record references and passes only the authenticated owner to the service', async () => {
  const caller = plannerChatRouter.createCaller({ userId: 'owner' });
  await expect(
    caller.resolveRecordPreview({ conversationId: id, id: 'foreign', action: 'accept' })
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  await caller.resolveRecordPreview({ conversationId: id, id, action: 'accept' });
  expect(workspaceRecords.resolve).toHaveBeenCalledWith('owner', id, id, 'accept', false);
});
