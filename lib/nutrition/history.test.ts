/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({ prisma: { nutritionLogEntry: { groupBy: jest.fn() } } }));
import { Decimal } from '@prisma/client/runtime/client';
import { prisma } from '@/lib/prisma';
import { nutritionHistory, nutritionHistoryDays } from './history';
import { historyInputSchema, copyMealSchema } from './reuse-schema';
const zero = { calories: '0', protein: '0', carbohydrates: '0', fat: '0', fiber: '0' };

it('fills calendar gaps with missing data and preserves explicitly logged zeros across month/year boundaries', () => {
  const days = nutritionHistoryDays('2026-01-03', 7, [
    { date: '2025-12-31', count: 1, nutrients: zero },
  ]);
  expect(days).toHaveLength(7);
  expect(days[0].date).toBe('2025-12-28');
  expect(days[3]).toMatchObject({ logged: true, nutrients: { calories: '0' } });
  expect(days[4]).toMatchObject({ logged: false, nutrients: null });
});
it('aggregates scalar historical snapshots in an owner-scoped inclusive date range', async () => {
  (prisma.nutritionLogEntry.groupBy as jest.Mock).mockResolvedValue([
    {
      logDate: new Date('2026-03-29T00:00:00Z'),
      _count: { _all: 2, fiber: 1 },
      _sum: {
        calories: new Decimal('176.40000001'),
        protein: new Decimal('7.5'),
        carbohydrates: new Decimal('6'),
        fat: new Decimal('15'),
        fiber: new Decimal('2'),
      },
    },
  ]);
  const result = await nutritionHistory.get('owner', { endDate: '2026-03-30', days: 30 });
  expect(prisma.nutritionLogEntry.groupBy).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        userId: 'owner',
        logDate: { gte: new Date('2026-03-01T00:00:00Z'), lte: new Date('2026-03-30T00:00:00Z') },
      },
    })
  );
  expect(result.loggedDays).toBe(1);
  expect(result.totals.calories).toBe('176.40000001');
  expect(result.totals.fiberIncomplete).toBe(true);
});
it('rejects invalid ranges, impossible dates and invalid copy selections', () => {
  expect(historyInputSchema.safeParse({ endDate: '0001-01-02', days: 7 }).success).toBe(false);
  expect(historyInputSchema.safeParse({ endDate: '2026-02-30', days: 30 }).success).toBe(false);
  expect(historyInputSchema.safeParse({ endDate: '2026-10-18', days: 8 }).success).toBe(false);
  const entry = { id: '00000000-0000-4000-8000-000000000001', version: 1 };
  const copy = {
    requestId: entry.id,
    sourceDate: '2026-10-17',
    targetDate: '2026-10-18',
    sourceMeal: 'LUNCH',
    targetMeal: 'LUNCH',
    entries: [entry],
  };
  expect(copyMealSchema.safeParse(copy).success).toBe(true);
  expect(copyMealSchema.safeParse({ ...copy, targetDate: copy.sourceDate }).success).toBe(false);
  expect(copyMealSchema.safeParse({ ...copy, entries: [entry, entry] }).success).toBe(false);
});
