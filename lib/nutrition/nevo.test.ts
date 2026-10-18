/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    product: { findMany: jest.fn(), createMany: jest.fn(), update: jest.fn() },
  },
}));
jest.mock('./product-index-queue', () => ({ enqueueProductIndex: jest.fn() }));
import { prisma } from '@/lib/prisma';
import { Prisma } from '../../generated/prisma/client';
import { nutritionNevo } from './nevo';
import { parseNevoCsv } from './nevo-csv';
import { nevoCsvFixture } from './nevo-test-fixtures';
import { enqueueProductIndex } from './product-index-queue';
const csv = nevoCsvFixture();
const date = new Date('2026-10-18T00:00:00Z');
function product() {
  const fields = parseNevoCsv(csv).rows[0].product;
  return {
    ...fields,
    id: '00000000-0000-4000-8000-000000000001',
    userId: 'owner',
    version: 1,
    referenceQuantity: new Prisma.Decimal(fields.referenceQuantity),
    calories: new Prisma.Decimal(fields.calories),
    protein: new Prisma.Decimal(fields.protein),
    carbohydrates: new Prisma.Decimal(fields.carbohydrates),
    fat: new Prisma.Decimal(fields.fat),
    fiber: new Prisma.Decimal(fields.fiber!),
    sourceType: 'DATASET',
    sourceName: 'NEVO',
    sourceRecordId: '1',
    sourceVersion: 'NEVO-Online 2025 9.0',
    sourceSnapshot: parseNevoCsv(csv).rows[0].original,
    importedAt: date,
    searchUpdatedAt: date,
    archivedAt: null as Date | null,
    userModifiedAt: null as Date | null,
    servings: [] as { quantity: Prisma.Decimal; canonicalUnit: string }[],
  };
}
beforeEach(() => {
  jest.resetAllMocks();
  (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(prisma));
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ claimed: true }]);
  (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
});
it('previews without writes, scopes source identity to the owner and creates dataset provenance', async () => {
  const preview = await nutritionNevo.preview('owner', { csv, overwriteEdited: false });
  expect(preview).toMatchObject({ create: 1, update: 0, total: 1 });
  expect(prisma.product.createMany).not.toHaveBeenCalled();
  expect(prisma.product.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userId: 'owner', sourceType: 'DATASET', sourceName: 'NEVO' },
    })
  );
  await nutritionNevo.apply('owner', { csv, overwriteEdited: false, planHash: preview.planHash });
  expect(prisma.product.createMany).toHaveBeenCalledWith({
    data: [
      expect.objectContaining({
        userId: 'owner',
        sourceType: 'DATASET',
        sourceName: 'NEVO',
        sourceRecordId: '1',
        sourceVersion: 'NEVO-Online 2025 9.0',
        verificationStatus: 'VERIFIED',
        name: 'Synthetic potatoes raw',
        aliases: ['Synthetische aardappelen rauw', 'Aardappel fixture'],
      }),
    ],
  });
  expect(enqueueProductIndex).toHaveBeenCalledWith(prisma, 'owner');
});
it('treats the same release/data as unchanged without writes or reindexing', async () => {
  (prisma.product.findMany as jest.Mock).mockResolvedValue([product()]);
  const preview = await nutritionNevo.preview('owner', { csv, overwriteEdited: false });
  expect(preview).toMatchObject({ create: 0, update: 0, unchanged: 1 });
  await nutritionNevo.apply('owner', { csv, overwriteEdited: false, planHash: preview.planHash });
  expect(prisma.product.update).not.toHaveBeenCalled();
  expect(prisma.product.createMany).not.toHaveBeenCalled();
  expect(enqueueProductIndex).not.toHaveBeenCalled();
});
it.each(['UNVERIFIED', 'ESTIMATED'] as const)(
  'verifies a previously %s unedited NEVO food when the same data is uploaded again',
  async (verificationStatus) => {
    (prisma.product.findMany as jest.Mock).mockResolvedValue([
      { ...product(), verificationStatus },
    ]);
    const preview = await nutritionNevo.preview('owner', { csv, overwriteEdited: false });
    expect(preview).toMatchObject({ create: 0, update: 1, unchanged: 0 });
    await nutritionNevo.apply('owner', { csv, overwriteEdited: false, planHash: preview.planHash });
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationStatus: 'VERIFIED',
          version: { increment: 1 },
        }),
      })
    );
    expect(enqueueProductIndex).not.toHaveBeenCalled();
  }
);
it('protects manually edited rows by default and permits an explicit imported-field update', async () => {
  const current = {
    ...product(),
    userModifiedAt: date,
    brand: 'Custom brand',
    calories: new Prisma.Decimal('99'),
  };
  (prisma.product.findMany as jest.Mock).mockResolvedValue([current]);
  const protectedPreview = await nutritionNevo.preview('owner', { csv, overwriteEdited: false });
  expect(protectedPreview).toMatchObject({
    protectedEdits: 1,
    update: 0,
  });
  await nutritionNevo.apply('owner', {
    csv,
    overwriteEdited: false,
    planHash: protectedPreview.planHash,
  });
  expect(prisma.product.update).not.toHaveBeenCalled();
  const preview = await nutritionNevo.preview('owner', { csv, overwriteEdited: true });
  expect(preview.update).toBe(1);
  await nutritionNevo.apply('owner', { csv, overwriteEdited: true, planHash: preview.planHash });
  const { where, data } = (prisma.product.update as jest.Mock).mock.calls[0][0];
  expect(where).toEqual({ id: current.id, userId: 'owner' });
  expect(data).toMatchObject({
    calories: '88',
    verificationStatus: 'VERIFIED',
    version: { increment: 1 },
  });
  expect(data).not.toHaveProperty('userModifiedAt');
  expect(data).not.toHaveProperty('brand');
  expect(data).not.toHaveProperty('servings');
  expect(data).not.toHaveProperty('archivedAt');
});
it('increments product versions but keeps vectors current for nutrient/release-only updates', async () => {
  (prisma.product.findMany as jest.Mock).mockResolvedValue([
    { ...product(), brand: 'Custom brand' },
  ]);
  const next = nevoCsvFixture([{ version: 'NEVO-Online 2026 10.0', calories: '90' }]);
  const preview = await nutritionNevo.preview('owner', { csv: next, overwriteEdited: false });
  await nutritionNevo.apply('owner', {
    csv: next,
    overwriteEdited: false,
    planHash: preview.planHash,
  });
  expect((prisma.product.update as jest.Mock).mock.calls[0][0].data.verificationStatus).toBe(
    'VERIFIED'
  );
  expect((prisma.product.update as jest.Mock).mock.calls[0][0].data).not.toHaveProperty(
    'searchUpdatedAt'
  );
  expect(enqueueProductIndex).not.toHaveBeenCalled();
});
it('invalidates changed descriptive text and preserves archive decisions and absent codes', async () => {
  const current = product();
  (prisma.product.findMany as jest.Mock).mockResolvedValue([
    current,
    { ...product(), id: 'other', sourceRecordId: '2', archivedAt: date },
  ]);
  const next = nevoCsvFixture([{ name: 'Synthetic potatoes updated' }]);
  const preview = await nutritionNevo.preview('owner', { csv: next, overwriteEdited: false });
  expect(preview.retained).toBe(1);
  await nutritionNevo.apply('owner', {
    csv: next,
    overwriteEdited: false,
    planHash: preview.planHash,
  });
  expect((prisma.product.update as jest.Mock).mock.calls[0][0].data.searchUpdatedAt).toBeInstanceOf(
    Date
  );
  expect(enqueueProductIndex).toHaveBeenCalledTimes(1);
});
it('rejects a stale preview before any writes and fences concurrent owner imports', async () => {
  const current = product();
  (prisma.product.findMany as jest.Mock).mockResolvedValue([current]);
  const preview = await nutritionNevo.preview('owner', { csv, overwriteEdited: false });
  (prisma.product.findMany as jest.Mock).mockResolvedValue([{ ...current, version: 2 }]);
  await expect(
    nutritionNevo.apply('owner', { csv, overwriteEdited: false, planHash: preview.planHash })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(prisma.product.update).not.toHaveBeenCalled();
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ claimed: false }]);
  await expect(
    nutritionNevo.apply('owner', { csv, overwriteEdited: false, planHash: preview.planHash })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('skips incompatible existing serving conversions even with manual-edit replacement selected', async () => {
  (prisma.product.findMany as jest.Mock).mockResolvedValue([
    { ...product(), servings: [{ quantity: new Prisma.Decimal('35'), canonicalUnit: 'G' }] },
  ]);
  const preview = await nutritionNevo.preview('owner', {
    csv: nevoCsvFixture([{ quantity: 'per 100ml' }]),
    overwriteEdited: true,
  });
  expect(preview).toMatchObject({ update: 0, conversionConflicts: 1 });
});
it('rejects invalid file rows before database access', async () => {
  await expect(
    nutritionNevo.preview('owner', {
      csv: nevoCsvFixture([{ protein: '' }]),
      overwriteEdited: false,
    })
  ).rejects.toThrow('PROT');
  expect(prisma.product.findMany).not.toHaveBeenCalled();
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
it('allows a previously known fiber value to become unknown without inventing zero', async () => {
  (prisma.product.findMany as jest.Mock).mockResolvedValue([product()]);
  const next = nevoCsvFixture([{ fiber: '' }]);
  const preview = await nutritionNevo.preview('owner', { csv: next, overwriteEdited: false });
  expect(preview.update).toBe(1);
  await nutritionNevo.apply('owner', {
    csv: next,
    overwriteEdited: false,
    planHash: preview.planHash,
  });
  expect((prisma.product.update as jest.Mock).mock.calls[0][0].data.fiber).toBeNull();
});
