/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('superjson', () => ({
  serialize: (value: unknown) => value,
  deserialize: (value: unknown) => value,
}));
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('@/lib/ai', () => jest.requireActual('@/lib/ai/errors'));
jest.mock('@/lib/model-settings/service', () => ({
  modelSettingsService: { get: jest.fn(), models: jest.fn(), update: jest.fn() },
}));
jest.mock('./service', () => ({ settingsService: {} }));
import { modelSettingsService } from '@/lib/model-settings/service';
import { settingsRouter } from './router';
beforeEach(() => jest.clearAllMocks());
it('requires authentication for reading, discovery, and writing model settings', async () => {
  const caller = settingsRouter.createCaller({ userId: null });
  await expect(caller.getAiModels()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  await expect(caller.listAiModels()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  await expect(caller.updateAiModel({ key: 'default', value: null })).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  expect(modelSettingsService.get).not.toHaveBeenCalled();
  expect(modelSettingsService.models).not.toHaveBeenCalled();
  expect(modelSettingsService.update).not.toHaveBeenCalled();
});
it('uses the authenticated owner and rejects invalid feature profiles at the boundary', async () => {
  const caller = settingsRouter.createCaller({ userId: 'owner' });
  await caller.getAiModels();
  await caller.updateAiModel({ key: 'aiDev.chat', value: { profile: 'fast' } });
  expect(modelSettingsService.get).toHaveBeenCalledWith('owner');
  expect(modelSettingsService.update).toHaveBeenCalledWith('owner', {
    key: 'aiDev.chat',
    value: { profile: 'fast' },
  });
  await expect(
    caller.updateAiModel({ key: 'aiDev.embeddings', value: { profile: 'fast' } })
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(modelSettingsService.update).toHaveBeenCalledTimes(1);
});
