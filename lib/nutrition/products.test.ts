/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    product: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('./search', () => ({ searchProductIds: jest.fn() }));
jest.mock('./product-search', () => ({ searchHybridProductIds: jest.fn() }));
jest.mock('./product-index-queue', () => ({ enqueueProductIndex: jest.fn() }));
import { Decimal } from '@prisma/client/runtime/client';
import { prisma } from '@/lib/prisma';
import { nutritionProducts } from './products';
import { searchProductIds } from './search';
import { enqueueProductIndex } from './product-index-queue';
import type { ProductInput } from './schema';

const id = '00000000-0000-4000-8000-000000000001';
const servingId = '00000000-0000-4000-8000-000000000002';
const input: ProductInput = {
  name: 'Peanut butter',
  brand: null,
  description: null,
  aliases: [],
  calculationMode: 'DIRECT',
  referenceQuantity: '100',
  referenceUnit: 'G',
  referenceLabel: null,
  calories: '588',
  protein: '25',
  carbohydrates: '20',
  fat: '50',
  fiber: null,
  servingSizeQuantity: null,
  servingSizeUnit: null,
  servingSizeIsEstimated: false,
  densityGramsPerMl: null,
  densityIsEstimated: false,
  verificationStatus: 'UNVERIFIED',
  servings: [],
};
const record = {
  ...input,
  id,
  userId: 'owner',
  referenceQuantity: new Decimal('100'),
  calories: new Decimal('588'),
  protein: new Decimal('25'),
  carbohydrates: new Decimal('20'),
  fat: new Decimal('50'),
  version: 1,
  archivedAt: null,
  sourceType: 'DATASET',
  sourceName: 'fixture',
  sourceRecordId: 'external:string',
  sourceVersion: 'v1',
  importedAt: null,
  userModifiedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  searchUpdatedAt: new Date('2026-10-18T00:00:00Z'),
  servings: [
    {
      id: servingId,
      productId: id,
      name: 'spoon',
      aliases: [],
      quantity: new Decimal('15'),
      canonicalUnit: 'G',
      isDefault: true,
      isEstimated: false,
    },
  ],
};
const db = {
  $queryRaw: jest.fn(),
  product: {
    findFirst: jest.fn(),
    findMany: prisma.product.findMany,
    update: jest.fn(),
    create: jest.fn(),
  },
  productEmbedding: { deleteMany: jest.fn() },
  productServing: {
    updateMany: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
    create: jest.fn(),
  },
  productComponent: { count: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
};
beforeEach(() => {
  jest.clearAllMocks();
  db.product.findFirst.mockResolvedValue(record);
  (db.product.findMany as jest.Mock).mockResolvedValue([]);
  db.product.update.mockResolvedValue(record);
  db.productComponent.count.mockResolvedValue(0);
  (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(db));
});
it('denies missing and foreign products for reads, calculations, updates and archival', async () => {
  (prisma.product.findFirst as jest.Mock).mockResolvedValue(null);
  db.product.findFirst.mockResolvedValue(null);
  await expect(nutritionProducts.get('other', id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    nutritionProducts.calculate('other', id, { quantity: '1', unit: 'G' })
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(nutritionProducts.update('other', id, 1, input)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await expect(nutritionProducts.setArchived('other', id, 1, true)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  expect(db.product.update).not.toHaveBeenCalled();
  expect(db.product.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id, userId: 'other' } })
  );
});
it('scopes search and returns decimal strings in ranked order', async () => {
  (searchProductIds as jest.Mock).mockResolvedValue({ ids: [id], total: 1 });
  (prisma.product.findMany as jest.Mock).mockResolvedValue([record]);
  const result = await nutritionProducts.list('owner', {
    query: 'PB',
    archived: false,
    limit: 20,
    offset: 0,
  });
  expect(searchProductIds).toHaveBeenCalledWith('owner', expect.objectContaining({ query: 'PB' }));
  expect(prisma.product.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: 'owner', id: { in: [id] }, archivedAt: null } })
  );
  expect(result.products[0].calories).toBe('588');
  expect(result.products[0]).not.toHaveProperty('userId');
});
it('creates only manually sourced products and rejects reused serving IDs', async () => {
  db.product.create.mockResolvedValue({ ...record, sourceType: 'MANUAL' });
  await nutritionProducts.create('owner', input);
  expect(db.product.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        userId: 'owner',
        sourceType: 'MANUAL',
        normalizedName: 'peanut butter',
      }),
    })
  );
  expect(enqueueProductIndex).toHaveBeenCalledWith(db, 'owner');
  await expect(
    nutritionProducts.create('owner', {
      ...input,
      servings: [
        {
          ...input,
          id: servingId,
          name: 'spoon',
          aliases: [],
          quantity: '15',
          canonicalUnit: 'G',
          isDefault: true,
          isEstimated: false,
        },
      ],
    })
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

it('rejects self references and missing or foreign ingredients before mutating product definitions', async () => {
  await expect(
    nutritionProducts.update('owner', id, 1, {
      ...input,
      components: [{ childProductId: id, quantity: '1', unit: 'G' }],
    })
  ).rejects.toThrow('cannot contain itself');
  await expect(
    nutritionProducts.create('owner', {
      ...input,
      components: [
        { childProductId: '00000000-0000-4000-8000-000000000099', quantity: '1', unit: 'G' },
      ],
    })
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(db.product.create).not.toHaveBeenCalled();
  expect(db.product.update).not.toHaveBeenCalled();
});

it('invalidates only embedded text changes and enqueues them in the product transaction', async () => {
  await nutritionProducts.update('owner', id, 1, { ...input, calories: '600' });
  expect(db.product.update.mock.calls[0][0].data).not.toHaveProperty('searchUpdatedAt');
  expect(enqueueProductIndex).not.toHaveBeenCalled();
  await nutritionProducts.update('owner', id, 1, { ...input, description: 'Roasted peanuts' });
  expect(db.product.update.mock.calls[1][0].data.searchUpdatedAt.getTime()).toBeGreaterThan(
    record.searchUpdatedAt.getTime()
  );
  expect(enqueueProductIndex).toHaveBeenCalledWith(db, 'owner');
});
it('removes archived vectors in the source transaction and queues restoration', async () => {
  await nutritionProducts.setArchived('owner', id, 1, true);
  expect(db.productEmbedding.deleteMany).toHaveBeenCalledWith({ where: { productId: id } });
  expect(enqueueProductIndex).toHaveBeenCalledWith(db, 'owner');
  jest.clearAllMocks();
  await nutritionProducts.setArchived('owner', id, 1, false);
  expect(db.productEmbedding.deleteMany).not.toHaveBeenCalled();
  expect(enqueueProductIndex).toHaveBeenCalledWith(db, 'owner');
});
it('rejects stale edits and serving IDs from another product before writes', async () => {
  await expect(nutritionProducts.update('owner', id, 2, input)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  await expect(
    nutritionProducts.update('owner', id, 1, {
      ...input,
      servings: [
        {
          id: '00000000-0000-4000-8000-000000000099',
          name: 'slice',
          aliases: [],
          quantity: '1',
          canonicalUnit: 'G',
          isDefault: false,
          isEstimated: false,
        },
      ],
    })
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(db.productServing.deleteMany).not.toHaveBeenCalled();
});
it('blocks removing a serving referenced by a component and archival of an active ingredient', async () => {
  db.productComponent.count.mockResolvedValue(1);
  await expect(nutritionProducts.update('owner', id, 1, input)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  await expect(nutritionProducts.setArchived('owner', id, 1, true)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  expect(db.product.update).not.toHaveBeenCalled();
});
it('preserves imported provenance and stable serving IDs on manual edits', async () => {
  await nutritionProducts.update('owner', id, 1, {
    ...input,
    servings: [
      {
        id: servingId,
        name: 'tablespoon',
        aliases: ['tbsp'],
        quantity: '15',
        canonicalUnit: 'G',
        isDefault: true,
        isEstimated: true,
      },
    ],
  });
  const write = db.product.update.mock.calls[0][0].data;
  expect(write.userModifiedAt).toBeInstanceOf(Date);
  expect(write.version).toEqual({ increment: 1 });
  expect(write).not.toHaveProperty('sourceType');
  expect(write).not.toHaveProperty('sourceRecordId');
  expect(write).not.toHaveProperty('sourceSnapshot');
  expect(db.productServing.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: servingId },
      data: expect.objectContaining({ name: 'tablespoon', isDefault: true }),
    })
  );
});
