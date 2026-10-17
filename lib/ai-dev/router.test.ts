/** @jest-environment node */

jest.mock('server-only', () => ({}));
// Caller tests exercise authentication without HTTP serialization.
jest.mock('superjson', () => ({
  serialize: (value: unknown) => value,
  deserialize: (value: unknown) => value,
}));
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('@/lib/ai', () => jest.requireActual('@/lib/ai/errors'));
jest.mock('./service', () => ({ aiDevService: { listChatModels: jest.fn() } }));

jest.mock('./conversations', () => ({
  conversationService: { list: jest.fn(), get: jest.fn(), create: jest.fn(), delete: jest.fn() },
}));

import { conversationService } from './conversations';
import { AiError } from '@/lib/ai';
import { aiDevRouter } from './router';
import { aiDevService } from './service';

beforeEach(() => {
  jest.resetAllMocks();
});

describe('aiDevRouter', () => {
  it('rejects unauthenticated model discovery', async () => {
    await expect(aiDevRouter.createCaller({ userId: null }).listChatModels()).rejects.toMatchObject(
      { code: 'UNAUTHORIZED' }
    );
    expect(aiDevService.listChatModels).not.toHaveBeenCalled();
  });

  it('returns models to an authenticated user', async () => {
    (aiDevService.listChatModels as jest.Mock).mockResolvedValue([]);
    await expect(aiDevRouter.createCaller({ userId: 'user-a' }).listChatModels()).resolves.toEqual(
      []
    );
  });

  it('reports safe provider failures', async () => {
    (aiDevService.listChatModels as jest.Mock).mockRejectedValue(
      new AiError('PROVIDER_UNAVAILABLE', 'Ollama is offline.')
    );
    await expect(
      aiDevRouter.createCaller({ userId: 'user-a' }).listChatModels()
    ).rejects.toMatchObject({ message: 'Ollama is offline.' });
  });
});

describe('conversation authorization', () => {
  const id = '45f6af99-9a30-4638-b05f-fb826b970379';
  it('requires authentication for all saved conversation operations', async () => {
    const caller = aiDevRouter.createCaller({ userId: null });
    await expect(caller.listConversations()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(caller.getConversation({ id })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(caller.deleteConversation({ id })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      caller.createConversation({ provider: 'ollama', modelId: 'chat:latest' })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(conversationService.get).not.toHaveBeenCalled();
  });
  it('takes the owner from the authenticated context', async () => {
    const caller = aiDevRouter.createCaller({ userId: 'user-a' });
    await caller.getConversation({ id });
    await caller.deleteConversation({ id });
    expect(conversationService.get).toHaveBeenCalledWith('user-a', id);
    expect(conversationService.delete).toHaveBeenCalledWith('user-a', id);
  });
});
