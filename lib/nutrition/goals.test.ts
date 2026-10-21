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
    fiber: null,
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

it('persists fiber and all milestones under the optimistic owner version', async () => {
  const semantics = { fiber: { kind: 'minimum' as const, preferredTarget: '30', excellent: '40' } };
  db.nutritionGoals.updateMany.mockResolvedValue({ count: 1 });
  db.nutritionGoals.findUniqueOrThrow.mockResolvedValue({
    fiber: new Decimal('25'),
    semantics,
    version: 2,
  });
  expect(
    await nutritionGoals.save('owner', { ...input, version: 1, fiber: '25', semantics })
  ).toMatchObject({ fiber: '25', semantics, version: 2 });
  expect(db.nutritionGoals.updateMany).toHaveBeenCalledWith({
    where: { userId: 'owner', version: 1 },
    data: expect.objectContaining({ fiber: '25', semantics, version: { increment: 1 } }),
  });
});

it('retains saved fiber for old callers and validates new thresholds against it', async () => {
  db.nutritionGoals.findUnique.mockResolvedValue({ fiber: new Decimal('25'), semantics: {} });
  db.nutritionGoals.updateMany.mockResolvedValue({ count: 1 });
  await expect(
    nutritionGoals.save('owner', {
      ...input,
      version: 1,
      semantics: { fiber: { kind: 'minimum', preferredTarget: '20' } },
    })
  ).rejects.toThrow();
  expect(db.nutritionGoals.updateMany).not.toHaveBeenCalled();
  await nutritionGoals.save('owner', { ...input, version: 1 });
  expect(db.nutritionGoals.updateMany.mock.calls[0][0].data).not.toHaveProperty('fiber');
});

it('clears an existing fiber goal explicitly instead of restoring a default', async () => {
  db.nutritionGoals.findUnique.mockResolvedValue({ fiber: new Decimal('35'), semantics: {} });
  db.nutritionGoals.updateMany.mockResolvedValue({ count: 1 });
  db.nutritionGoals.findUniqueOrThrow.mockResolvedValue({ fiber: null, version: 2 });
  expect(await nutritionGoals.save('owner', { ...input, version: 1, fiber: null })).toMatchObject({
    fiber: null,
  });
  expect(db.nutritionGoals.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ fiber: null }) })
  );
});
