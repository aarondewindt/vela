/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: { plannerGenerationSettings: { findUnique: jest.fn() }, $transaction: jest.fn() },
}));
import { prisma } from '@/lib/prisma';
import { mealService } from './meal-service';
import { DEFAULT_MEAL_PREFERENCES } from './meals';
const tx = { plannerGenerationSettings: { upsert: jest.fn(), updateMany: jest.fn() } };
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(tx));
  tx.plannerGenerationSettings.updateMany.mockResolvedValue({ count: 1 });
});
it('returns disabled defaults without writing or modifying another planner setting', async () => {
  jest.mocked(prisma.plannerGenerationSettings.findUnique).mockResolvedValue(null);
  expect(await mealService.get('owner')).toEqual({
    preferences: DEFAULT_MEAL_PREFERENCES,
    version: 0,
  });
  expect(prisma.plannerGenerationSettings.findUnique).toHaveBeenCalledWith({
    where: { userId: 'owner' },
  });
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
it('saves an owner-scoped versioned preference document without replacing session/leisure defaults', async () => {
  const result = await mealService.save('owner', {
    version: 2,
    preferences: DEFAULT_MEAL_PREFERENCES,
  });
  expect(result.version).toBe(3);
  expect(tx.plannerGenerationSettings.upsert).toHaveBeenCalledWith({
    where: { userId: 'owner' },
    create: { userId: 'owner' },
    update: {},
  });
  expect(tx.plannerGenerationSettings.updateMany).toHaveBeenCalledWith({
    where: { userId: 'owner', mealVersion: 2 },
    data: { mealPreferences: DEFAULT_MEAL_PREFERENCES, mealVersion: { increment: 1 } },
  });
});
it('rejects concurrent/stale saves without accepting an overwritten preference document', async () => {
  tx.plannerGenerationSettings.updateMany.mockResolvedValue({ count: 0 });
  await expect(
    mealService.save('owner', { version: 0, preferences: DEFAULT_MEAL_PREFERENCES })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('validates before persistence and does not swallow database failures', async () => {
  await expect(
    mealService.save('owner', { version: -1, preferences: DEFAULT_MEAL_PREFERENCES })
  ).rejects.toThrow();
  expect(prisma.$transaction).not.toHaveBeenCalled();
  tx.plannerGenerationSettings.upsert.mockRejectedValue(new Error('Database unavailable'));
  await expect(
    mealService.save('owner', { version: 0, preferences: DEFAULT_MEAL_PREFERENCES })
  ).rejects.toThrow('Database unavailable');
});

it('maps a concurrent first-create uniqueness race to a reloadable version conflict', async () => {
  const { Prisma } = await import('../../generated/prisma/client');
  tx.plannerGenerationSettings.upsert.mockRejectedValue(
    new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: 'test' })
  );
  await expect(
    mealService.save('owner', { version: 0, preferences: DEFAULT_MEAL_PREFERENCES })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});
