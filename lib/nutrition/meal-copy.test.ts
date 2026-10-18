/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({ prisma: { $transaction: jest.fn() } }));
import { Decimal } from '@prisma/client/runtime/client';
import { prisma } from '@/lib/prisma';
import { copyNutritionMeal } from './meal-copy';
import { entryFixture } from './test-fixtures';
const source = {
  ...entryFixture,
  userId: 'owner',
  productNameSnapshot: entryFixture.productName,
  referenceSnapshot: entryFixture.snapshot,
  productId: null,
  quantity: new Decimal('30'),
  resolvedQuantity: new Decimal('30'),
  calories: new Decimal('176.4'),
  protein: new Decimal('7.5'),
  carbohydrates: new Decimal('6'),
  fat: new Decimal('15'),
  fiber: null,
  logDate: new Date('2026-10-17T00:00:00Z'),
  createdAt: new Date(),
  updatedAt: new Date(),
};
const input = {
  requestId: '00000000-0000-4000-8000-000000000009',
  sourceDate: '2026-10-17',
  targetDate: '2026-10-18',
  sourceMeal: 'BREAKFAST' as const,
  targetMeal: 'LUNCH' as const,
  entries: [{ id: source.id, version: 1 }],
};
const db = {
  $queryRaw: jest.fn(),
  nutritionLogEntry: { findMany: jest.fn(), create: jest.fn() },
  nutritionMealCopy: { findUnique: jest.fn(), create: jest.fn() },
};
beforeEach(() => {
  jest.resetAllMocks();
  (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(db));
  db.nutritionLogEntry.findMany.mockResolvedValue([source]);
  db.nutritionLogEntry.create.mockResolvedValue({ id: 'copy-id' });
});
it('copies saved nutrients, conversions and composition without consulting live or deleted products', async () => {
  const result = await copyNutritionMeal('owner', input);
  expect(result.entryIds).toEqual(['copy-id']);
  expect(db.nutritionLogEntry.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        userId: 'owner',
        id: { in: [source.id] },
        logDate: source.logDate,
        mealCategory: 'BREAKFAST',
      },
    })
  );
  const write = db.nutritionLogEntry.create.mock.calls[0][0].data;
  expect(write.referenceSnapshot).toEqual(source.referenceSnapshot);
  expect(write.calories.toFixed()).toBe('176.4');
  expect(write.productId).toBeNull();
  expect(write.logDate).toEqual(new Date('2026-10-18T00:00:00Z'));
  expect(write.mealCategory).toBe('LUNCH');
});
it('replays a completed request even after copied or source entries have been removed', async () => {
  await copyNutritionMeal('owner', input);
  const receipt = db.nutritionMealCopy.create.mock.calls[0][0].data;
  db.nutritionMealCopy.findUnique.mockResolvedValue(receipt);
  db.nutritionLogEntry.findMany.mockResolvedValue([]);
  expect(await copyNutritionMeal('owner', input)).toEqual({
    entryIds: ['copy-id'],
    date: '2026-10-18',
  });
  expect(db.nutritionLogEntry.create).toHaveBeenCalledTimes(1);
  await expect(
    copyNutritionMeal('owner', { ...input, targetMeal: 'DINNER' })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('rejects missing, foreign and stale sources before any insert', async () => {
  db.nutritionLogEntry.findMany.mockResolvedValue([]);
  await expect(copyNutritionMeal('other', input)).rejects.toMatchObject({ code: 'CONFLICT' });
  db.nutritionLogEntry.findMany.mockResolvedValue([{ ...source, version: 2 }]);
  await expect(copyNutritionMeal('owner', input)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(db.nutritionLogEntry.create).not.toHaveBeenCalled();
  expect(db.nutritionMealCopy.create).not.toHaveBeenCalled();
});
