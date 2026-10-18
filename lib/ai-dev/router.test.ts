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
jest.mock('./embeddings', () => ({
  embeddingService: {
    listModels: jest.fn(),
    generateForUser: jest.fn(),
    compareForUser: jest.fn(),
  },
}));

jest.mock('./conversations', () => ({
  conversationService: { list: jest.fn(), get: jest.fn(), create: jest.fn(), delete: jest.fn() },
}));

import { conversationService } from './conversations';
import { AiError } from '@/lib/ai';
import { aiDevRouter } from './router';
import { aiDevService } from './service';
import { embeddingService } from './embeddings';

beforeEach(() => {
  jest.resetAllMocks();
});

describe('embedding procedures', () => {
  const selection = { provider: 'ollama' as const, modelId: 'embedding:latest' };
  it('requires authentication for discovery and inference', async () => {
    const caller = aiDevRouter.createCaller({ userId: null });
    await expect(caller.listEmbeddingModels()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(caller.generateEmbedding({ selection, text: 'Hello' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(
      caller.compareEmbeddings({ selection, textA: 'First', textB: 'Second' })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(embeddingService.listModels).not.toHaveBeenCalled();
    expect(embeddingService.generateForUser).not.toHaveBeenCalled();
    expect(embeddingService.compareForUser).not.toHaveBeenCalled();
  });
  it('delegates validated input and returns results', async () => {
    const caller = aiDevRouter.createCaller({ userId: 'user-a' });
    (embeddingService.listModels as jest.Mock).mockResolvedValue([]);
    (embeddingService.generateForUser as jest.Mock).mockResolvedValue({ dimensions: 1024 });
    (embeddingService.compareForUser as jest.Mock).mockResolvedValue({ similarity: 0.75 });
    await expect(caller.listEmbeddingModels()).resolves.toEqual([]);
    await expect(caller.generateEmbedding({ selection, text: 'Hello' })).resolves.toEqual({
      dimensions: 1024,
    });
    await expect(
      caller.compareEmbeddings({ selection, textA: 'First', textB: 'Second' })
    ).resolves.toEqual({ similarity: 0.75 });
    expect(embeddingService.generateForUser).toHaveBeenCalledWith('user-a', {
      selection,
      text: 'Hello',
    });
    expect(embeddingService.compareForUser).toHaveBeenCalledWith('user-a', {
      selection,
      textA: 'First',
      textB: 'Second',
    });
  });
  it('rejects blank inputs before inference', async () => {
    await expect(
      aiDevRouter.createCaller({ userId: 'user-a' }).generateEmbedding({ selection, text: '  ' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(embeddingService.generateForUser).not.toHaveBeenCalled();
  });
  it('masks unknown provider errors', async () => {
    (embeddingService.generateForUser as jest.Mock).mockRejectedValue(
      new Error('private provider body')
    );
    await expect(
      aiDevRouter.createCaller({ userId: 'user-a' }).generateEmbedding({ selection, text: 'Hello' })
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'AI Dev is temporarily unavailable. Please try again.',
    });
  });
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
      caller.createConversation({ selection: { provider: 'ollama', modelId: 'chat:latest' } })
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
