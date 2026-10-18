/** @jest-environment node */
jest.mock('server-only', () => ({}));
import { productEmbeddingAdapter } from './product-embedding-adapter';
import type { Prisma } from '../../generated/prisma/client';
it('loads an entire NEVO-sized catalog without the earlier 1,000-product cutoff', async () => {
  const findMany = jest.fn().mockResolvedValue(
    Array.from({ length: 2328 }, (_, index) => ({
      id: `fixture-${index}`,
      name: `Synthetic food ${index}`,
      brand: null,
      description: null,
      aliases: [],
      searchUpdatedAt: new Date(0),
    }))
  );
  const db = { product: { findMany } } as unknown as Prisma.TransactionClient;
  const documents = await productEmbeddingAdapter.documents(db, 'owner');
  expect(documents).toHaveLength(2328);
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: 'owner', archivedAt: null } })
  );
});
