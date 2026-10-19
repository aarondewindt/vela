/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('superjson', () => ({ serialize: (v: unknown) => v, deserialize: (v: unknown) => v }));
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('./service', () => ({
  healthService: {
    history: jest.fn(),
    diagnostics: jest.fn(),
    saveGoal: jest.fn(),
    mappings: jest.fn(),
    saveMappings: jest.fn(),
    log: jest.fn(),
    remove: jest.fn(),
  },
}));
jest.mock('@/lib/integrations/home-assistant/service', () => {
  const { z } = jest.requireActual('zod');
  return {
    connectionSchema: z.object({
      baseUrl: z.string(),
      enabled: z.boolean(),
      revision: z.number(),
      token: z.string().optional(),
    }),
    homeAssistantService: { get: jest.fn(), save: jest.fn(), entities: jest.fn() },
  };
});
import { healthRouter } from './router';
import { healthService } from './service';
import { homeAssistantRouter } from '@/lib/integrations/home-assistant/router';
import { homeAssistantService } from '@/lib/integrations/home-assistant/service';
beforeEach(() => jest.clearAllMocks());
it('requires authentication for health records and connection credentials', async () => {
  const health = healthRouter.createCaller({ userId: null });
  const ha = homeAssistantRouter.createCaller({ userId: null });
  for (const call of [
    () => health.history({ endDate: '2026-01-10', days: 7 }),
    () => health.mappings(),
    () => health.diagnostics(),
    () => health.saveGoal({ version: 0, calorieBalance: -300 }),
    () => health.remove({ id: '00000000-0000-4000-8000-000000000001' }),
    () => ha.get(),
    () => ha.entities(),
    () => ha.save({ baseUrl: 'http://ha', enabled: true, revision: 0 }),
  ]) {
    await expect(call()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  }
  expect(homeAssistantService.get).not.toHaveBeenCalled();
  expect(healthService.history).not.toHaveBeenCalled();
});
it('always obtains the owner from the session and validates balance goals', async () => {
  const health = healthRouter.createCaller({ userId: 'alice' });
  const ha = homeAssistantRouter.createCaller({ userId: 'alice' });
  await health.saveGoal({ version: 0, calorieBalance: -300, userId: 'bob' } as never);
  expect(healthService.saveGoal).toHaveBeenCalledWith('alice', {
    version: 0,
    calorieBalance: -300,
  });
  await health.diagnostics();
  expect(healthService.diagnostics).toHaveBeenCalledWith('alice');
  await ha.get();
  expect(homeAssistantService.get).toHaveBeenCalledWith('alice');
  await expect(health.saveGoal({ version: 0, calorieBalance: 10001 })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
});
