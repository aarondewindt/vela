/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({ prisma: { product: { findMany: jest.fn() } } }));
jest.mock('./search', () => ({ searchProductIds: jest.fn() }));
jest.mock('./product-index', () => ({ productCollection: { search: jest.fn() } }));
import { prisma } from '@/lib/prisma';
import { AiError } from '@/lib/ai/errors';
import { EmbeddingCollectionError } from '@/lib/embeddings/errors';
import { productCollection } from './product-index';
import { searchProductIds } from './search';
import { searchHybridProductIds } from './product-search';
const input = { query: '  PB  ', semantic: true, limit: 5 };
beforeEach(() => {
  jest.resetAllMocks();
  (searchProductIds as jest.Mock).mockResolvedValue({ ids: ['a', 'b', 'c'], total: 3 });
  (prisma.product.findMany as jest.Mock).mockResolvedValue([
    { id: 'a', normalizedName: 'pb', normalizedAliases: [] },
    { id: 'b', normalizedName: 'peanut butter', normalizedAliases: ['pb'] },
    { id: 'c', normalizedName: 'spread', normalizedAliases: [] },
  ]);
  (productCollection.search as jest.Mock).mockResolvedValue({
    results: [
      { id: 'd', similarity: 0.99 },
      { id: 'b', similarity: 0.7 },
      { id: 'e', similarity: 0.6 },
    ],
  });
});
it('keeps exact names, aliases and text ahead of semantic alternatives, deduplicates and exposes raw scores', async () => {
  const result = await searchHybridProductIds('owner', input);
  expect(result.matches.map((match) => [match.id, match.kind])).toEqual([
    ['a', 'name'],
    ['b', 'alias'],
    ['c', 'text'],
    ['d', 'semantic'],
    ['e', 'semantic'],
  ]);
  expect(result.matches[1].similarity).toBe(0.7);
  expect(result.semantic).toBe('available');
  expect(productCollection.search).toHaveBeenCalledWith('owner', 'pb', 5, expect.any(AbortSignal));
  expect(prisma.product.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userId: 'owner', archivedAt: null, id: { in: ['a', 'b', 'c'] } },
    })
  );
});
it('prioritizes related foods for drafts even when substring matches fill the entire page', async () => {
  const ids = ['bobotie', 'cereal', 'beans', 'bar', 'chocolate'];
  (searchProductIds as jest.Mock).mockResolvedValue({ ids, total: 40 });
  (prisma.product.findMany as jest.Mock).mockResolvedValue(
    ids.map((id) => ({ id, normalizedName: `${id} with rice`, normalizedAliases: [] }))
  );
  (productCollection.search as jest.Mock).mockResolvedValue({
    results: [
      { id: 'cooked-rice', similarity: 0.95 },
      { id: 'brown-rice', similarity: 0.9 },
      { id: 'bobotie', similarity: 0.6 },
    ],
  });
  const result = await searchHybridProductIds('owner', {
    query: 'rice',
    semantic: true,
    ranking: 'related-first',
    limit: 5,
  });
  expect(result.matches.map((match) => match.id)).toEqual([
    'cooked-rice',
    'brown-rice',
    'bobotie',
    'cereal',
    'beans',
  ]);
  expect(result.matches[2]).toEqual({ id: 'bobotie', kind: 'text', similarity: 0.6 });
  expect(result.textTotal).toBe(40);
});
it('preserves exact names and aliases ahead of related suggestions and deduplicates them', async () => {
  const result = await searchHybridProductIds('owner', { ...input, ranking: 'related-first' });
  expect(result.matches.map((match) => [match.id, match.kind])).toEqual([
    ['a', 'name'],
    ['b', 'alias'],
    ['d', 'semantic'],
    ['e', 'semantic'],
    ['c', 'text'],
  ]);
});
it('falls back to text matches with a notice when related-first search is unavailable', async () => {
  (productCollection.search as jest.Mock).mockRejectedValue(
    new EmbeddingCollectionError('PRECONDITION_FAILED', 'Rebuild required')
  );
  const result = await searchHybridProductIds('owner', { ...input, ranking: 'related-first' });
  expect(result.matches.map((match) => match.id)).toEqual(['a', 'b', 'c']);
  expect(result.notice).toContain('Related-food search is unavailable');
});
it('forwards cancellation when a caller supplies a deadline', async () => {
  const controller = new AbortController();
  await searchHybridProductIds('owner', input, controller.signal);
  const signal = (productCollection.search as jest.Mock).mock.calls[0][3] as AbortSignal;
  expect(signal.aborted).toBe(false);
  controller.abort();
  expect(signal.aborted).toBe(true);
});
it.each([
  new AiError('PROVIDER_UNAVAILABLE', 'Provider unavailable'),
  new EmbeddingCollectionError('PRECONDITION_FAILED', 'Rebuild required'),
  new EmbeddingCollectionError('CONFLICT', 'Configuration changed'),
])('keeps conventional matches on expected semantic failure: %s', async (error) => {
  (productCollection.search as jest.Mock).mockRejectedValue(error);
  const result = await searchHybridProductIds('owner', input);
  expect(result.semantic).toBe('unavailable');
  expect(result.notice).toContain('Showing name, alias');
  expect(result.matches.map((match) => match.id)).toEqual(['a', 'b', 'c']);
});
it('does not hide unexpected storage failures', async () => {
  (productCollection.search as jest.Mock).mockRejectedValue(new Error('Database failure'));
  await expect(searchHybridProductIds('owner', input)).rejects.toThrow('Database failure');
});
it('never calls the model for empty queries or conventional-only search', async () => {
  for (const options of [
    { ...input, query: '' },
    { ...input, semantic: false },
  ]) {
    expect((await searchHybridProductIds('owner', options)).semantic).toBe('off');
  }
  expect(productCollection.search).not.toHaveBeenCalled();
});
