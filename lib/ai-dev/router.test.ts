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
