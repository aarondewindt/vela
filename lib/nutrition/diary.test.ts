/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    nutritionLogEntry: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('./products', () => ({ nutritionProducts: { get: jest.fn() } }));
jest.mock('./goals', () => ({ nutritionGoals: { get: jest.fn() } }));
import { createHash } from 'node:crypto';
import { Decimal } from '@prisma/client/runtime/client';
import { prisma } from '@/lib/prisma';
import { nutritionDiary } from './diary';
import { nutritionProducts } from './products';
import { nutritionGoals } from './goals';
import { createLogEntrySchema } from './diary-schema';
import { entryFixture, productFixture } from './test-fixtures';

const input = {
  requestId: '00000000-0000-4000-8000-000000000004',
  productId: productFixture.id,
  productVersion: 1,
  logDate: '2026-10-17',
  mealCategory: 'BREAKFAST' as const,
  input: { quantity: '30', unit: 'G' as const },
};
const requestHash = createHash('sha256')
  .update(JSON.stringify(createLogEntrySchema.parse(input)))
  .digest('hex');
const record = {
  ...entryFixture,
  userId: 'owner',
  logDate: new Date('2026-10-17T00:00:00Z'),
  productNameSnapshot: entryFixture.productName,
  quantity: new Decimal('30'),
  unitLabelSnapshot: 'g',
  resolvedQuantity: new Decimal('30'),
  referenceUnit: 'G',
  calories: new Decimal('176.4'),
  protein: new Decimal('7.5'),
  carbohydrates: new Decimal('6'),
  fat: new Decimal('15'),
  fiber: null,
  referenceSnapshot: entryFixture.snapshot,
  requestId: input.requestId,
  requestHash,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const db = {
  $queryRaw: jest.fn(),
  nutritionLogEntry: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};
beforeEach(() => {
  jest.clearAllMocks();
  (prisma.$transaction as jest.Mock).mockImplementation((operation) => operation(db));
  db.nutritionLogEntry.findUnique.mockResolvedValue(null);
  db.nutritionLogEntry.findFirst.mockResolvedValue(record);
  db.nutritionLogEntry.upsert.mockResolvedValue(record);
  db.nutritionLogEntry.update.mockResolvedValue(record);
  (nutritionProducts.get as jest.Mock).mockResolvedValue(productFixture);
  (nutritionGoals.get as jest.Mock).mockResolvedValue({
    calories: null,
    protein: null,
    carbohydrates: null,
    fat: null,
    version: 0,
  });
});
it('creates one owner-scoped historical entry from a locked consistent product source', async () => {
  expect((await nutritionDiary.create('owner', input)).nutrients.calories).toBe('176.4');
  expect(nutritionProducts.get).toHaveBeenCalledWith('owner', input.productId, db);
  expect(db.nutritionLogEntry.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userId_requestId: { userId: 'owner', requestId: input.requestId } },
      create: expect.objectContaining({
        userId: 'owner',
        productNameSnapshot: 'Peanut butter',
        calories: '176.4',
        referenceSnapshot: expect.objectContaining({ schemaVersion: 1 }),
      }),
    })
  );
});
it('replays the same request without consulting mutable or archived source data', async () => {
  db.nutritionLogEntry.findUnique.mockResolvedValue(record);
  await expect(nutritionDiary.create('owner', input)).resolves.toMatchObject({ id: record.id });
  expect(nutritionProducts.get).not.toHaveBeenCalled();
  expect(db.nutritionLogEntry.upsert).not.toHaveBeenCalled();
  await expect(
    nutritionDiary.create('owner', { ...input, input: { quantity: '31', unit: 'G' } })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('rejects archived products and stale product versions before saving', async () => {
  (nutritionProducts.get as jest.Mock).mockResolvedValue({
    ...productFixture,
    archivedAt: new Date(),
  });
  await expect(nutritionDiary.create('owner', input)).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  (nutritionProducts.get as jest.Mock).mockResolvedValue({ ...productFixture, version: 2 });
  await expect(nutritionDiary.create('owner', input)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(db.nutritionLogEntry.upsert).not.toHaveBeenCalled();
});
it('edits quantity, meal and date using only the stored snapshot', async () => {
  await nutritionDiary.update('owner', {
    id: record.id,
    version: 1,
    logDate: '2026-10-18',
    mealCategory: 'LUNCH',
    input: { quantity: '60', unit: 'G' },
  });
  const write = db.nutritionLogEntry.update.mock.calls[0][0];
  expect(write.where).toEqual({ id: record.id, userId: 'owner' });
  expect(write.data).toMatchObject({
    calories: '352.8',
    protein: '15',
    mealCategory: 'LUNCH',
    logDate: new Date('2026-10-18T00:00:00Z'),
    version: { increment: 1 },
  });
  expect(write.data).not.toHaveProperty('referenceSnapshot');
  expect(nutritionProducts.get).not.toHaveBeenCalled();
});
it('rejects stale quantity edits and deletes before mutation', async () => {
  await expect(
    nutritionDiary.update('owner', {
      id: record.id,
      version: 2,
      logDate: input.logDate,
      mealCategory: 'BREAKFAST',
      input: input.input,
    })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(nutritionDiary.remove('owner', record.id, 2)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  expect(db.nutritionLogEntry.update).not.toHaveBeenCalled();
  expect(db.nutritionLogEntry.delete).not.toHaveBeenCalled();
});
it('denies foreign entry edits, removals and previews by the same not-found contract', async () => {
  db.nutritionLogEntry.findFirst.mockResolvedValue(null);
  (prisma.nutritionLogEntry.findFirst as jest.Mock).mockResolvedValue(null);
  await expect(
    nutritionDiary.update('other', {
      id: record.id,
      version: 1,
      logDate: input.logDate,
      mealCategory: 'BREAKFAST',
      input: input.input,
    })
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(nutritionDiary.remove('other', record.id, 1)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await expect(nutritionDiary.preview('other', record.id, input.input)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  expect(db.nutritionLogEntry.findFirst).toHaveBeenCalledWith({
    where: { id: record.id, userId: 'other' },
  });
});
it('reads only the requested owner/calendar date and totals stored snapshots', async () => {
  (prisma.nutritionLogEntry.findMany as jest.Mock).mockResolvedValue([record]);
  const result = await nutritionDiary.day('owner', '2026-10-17');
  expect(prisma.nutritionLogEntry.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userId: 'owner', logDate: new Date('2026-10-17T00:00:00Z') },
    })
  );
  expect(result.totals.calories).toBe('176.4');
  expect(result.progress.calories.goal).toBe(null);
});
