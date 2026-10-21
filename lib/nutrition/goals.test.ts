/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: { nutritionGoals: { findUnique: jest.fn() }, $transaction: jest.fn() },
}));
import { Decimal } from '@prisma/client/runtime/client';
import { prisma } from '@/lib/prisma';
import { nutritionGoals } from './goals';

const input = { version: 0, calories: '2400', protein: '160', carbohydrates: null, fat: null };
const db = {
  nutritionGoals: {
    findUnique: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
};
beforeEach(() => {
  jest.clearAllMocks();
  (prisma.$transaction as jest.Mock).mockImplementation((operation) => operation(db));
  db.nutritionGoals.findUniqueOrThrow.mockResolvedValue({
    calories: new Decimal('2400'),
    protein: new Decimal('160'),
    carbohydrates: null,
    fat: null,
    version: 1,
  });
});
it('does not prescribe goals for a user without settings', async () => {
  (prisma.nutritionGoals.findUnique as jest.Mock).mockResolvedValue(null);
  expect(await nutritionGoals.get('owner')).toEqual({
    semantics: {},
    calories: null,
    protein: null,
    carbohydrates: null,
    fat: null,
    version: 0,
  });
});
it('creates only the authenticated owner’s explicit goals', async () => {
  expect(await nutritionGoals.save('owner', input)).toMatchObject({
    calories: '2400',
    protein: '160',
    version: 1,
  });
  expect(db.nutritionGoals.create).toHaveBeenCalledWith({
    data: {
      semantics: {},
      userId: 'owner',
      calories: '2400',
      protein: '160',
      carbohydrates: null,
      fat: null,
    },
  });
});
it('fences concurrent updates and rejects zero targets', async () => {
  db.nutritionGoals.updateMany.mockResolvedValue({ count: 0 });
  await expect(nutritionGoals.save('owner', { ...input, version: 1 })).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  expect(db.nutritionGoals.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: 'owner', version: 1 } })
  );
  await expect(nutritionGoals.save('owner', { ...input, calories: '0' })).rejects.toThrow();
});

it('persists semantic options with existing amounts and preserves them for legacy callers', async () => {
  const semantics = {
    protein: { kind: 'minimum' as const },
    calories: { kind: 'range' as const, upperBound: '2600' },
  };
  db.nutritionGoals.findUniqueOrThrow.mockResolvedValue({ version: 2, semantics });
  await nutritionGoals.save('owner', { ...input, semantics });
  expect(db.nutritionGoals.create).toHaveBeenCalledWith({
    data: {
      calories: '2400',
      protein: '160',
      carbohydrates: null,
      fat: null,
      userId: 'owner',
      semantics,
    },
  });
  db.nutritionGoals.findUnique.mockResolvedValue({ semantics });
  db.nutritionGoals.updateMany.mockResolvedValue({ count: 1 });
  await nutritionGoals.save('owner', { ...input, version: 1 });
  expect(db.nutritionGoals.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userId: 'owner', version: 1 },
      data: expect.objectContaining({ semantics }),
    })
  );
  await expect(
    nutritionGoals.save('owner', { ...input, calories: '2700', version: 1 })
  ).rejects.toThrow();
});
