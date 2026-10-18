/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: { userAiModelSetting: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() } },
}));
jest.mock('@/lib/ai', () => ({ discoverModels: jest.fn(), validateModelSelection: jest.fn() }));
import { prisma } from '@/lib/prisma';
import { validateModelSelection } from '@/lib/ai';
import { effectiveModel, modelSettingsService, requireModelSelection } from './service';
const selection = { provider: 'ollama' as const, modelId: 'test:latest' };
beforeEach(() => {
  jest.resetAllMocks();
  (prisma.userAiModelSetting.findMany as jest.Mock).mockResolvedValue([]);
});
it('reads only the authenticated user settings and resolves fresh settings for subsequent turns', async () => {
  (prisma.userAiModelSetting.findMany as jest.Mock).mockResolvedValueOnce([
    { key: 'default', value: selection },
  ]);
  expect((await effectiveModel('owner', 'aiDev.chat')).selection).toEqual(selection);
  expect((await effectiveModel('owner', 'aiDev.chat')).selection).toBeNull();
  expect(prisma.userAiModelSetting.findMany).toHaveBeenCalledWith({
    where: { userId: 'owner' },
    select: { key: true, value: true },
  });
});
it('lets a conversation override work without configured defaults', async () => {
  expect(await requireModelSelection('owner', 'aiDev.chat', selection)).toEqual(selection);
  expect(prisma.userAiModelSetting.findMany).not.toHaveBeenCalled();
});
it('reports missing configuration without selecting an arbitrary installed model', async () => {
  await expect(requireModelSelection('owner', 'aiDev.chat')).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
});
it.each([
  ['default', ['chat']],
  ['embeddings', ['embedding']],
  ['visionLanguage', ['chat', 'vision']],
])('validates %s capabilities before persisting', async (key, capabilities) => {
  await modelSettingsService.update('owner', { key, value: selection });
  expect(validateModelSelection).toHaveBeenCalledWith(selection, capabilities);
  expect(prisma.userAiModelSetting.upsert).toHaveBeenCalledWith({
    where: { userId_key: { userId: 'owner', key } },
    create: { userId: 'owner', key, value: selection },
    update: { value: selection },
  });
});
it('preserves the saved preference if its replacement fails validation', async () => {
  (validateModelSelection as jest.Mock).mockRejectedValue(new Error('Unavailable'));
  await expect(
    modelSettingsService.update('owner', { key: 'default', value: selection })
  ).rejects.toThrow('Unavailable');
  expect(prisma.userAiModelSetting.upsert).not.toHaveBeenCalled();
});
it('clears only the owner preference to restore inheritance, without a provider request', async () => {
  await modelSettingsService.update('owner', { key: 'balanced', value: null });
  expect(prisma.userAiModelSetting.deleteMany).toHaveBeenCalledWith({
    where: { userId: 'owner', key: 'balanced' },
  });
  expect(validateModelSelection).not.toHaveBeenCalled();
});
it('saves feature profile references without touching shared embedding configurations', async () => {
  await modelSettingsService.update('owner', {
    key: 'aiDev.embeddings',
    value: { profile: 'embeddings' },
  });
  expect(prisma.userAiModelSetting.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId_key: { userId: 'owner', key: 'aiDev.embeddings' } } })
  );
});
