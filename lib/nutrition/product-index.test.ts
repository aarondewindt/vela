/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/ai', () => ({ discoverModels: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: { nutritionProductIndexJob: { findUnique: jest.fn() } },
}));
jest.mock('./product-index-queue', () => ({ enqueueProductIndex: jest.fn() }));
jest.mock('@/lib/embeddings/collection', () => ({
  createEmbeddingCollection: jest.fn(() => ({ status: jest.fn(), rebuild: jest.fn() })),
}));
import { nutritionProductIndex, productCollection } from './product-index';
import { prisma } from '@/lib/prisma';
import { enqueueProductIndex } from './product-index-queue';
import { productRebuildSchema } from './product-search-schema';
const original = process.env.EMBEDDING_MAINTAINER_USER_IDS;
afterAll(() => {
  if (original === undefined) {
    delete process.env.EMBEDDING_MAINTAINER_USER_IDS;
  } else {
    process.env.EMBEDDING_MAINTAINER_USER_IDS = original;
  }
});
beforeEach(() => {
  jest.clearAllMocks();
  process.env.EMBEDDING_MAINTAINER_USER_IDS = 'maintainer';
});
it('denies model changes and discovery before collection/provider work for ordinary users', async () => {
  await expect(
    nutritionProductIndex.rebuild('ordinary', { provider: 'ollama', modelId: 'embed' }, '')
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(nutritionProductIndex.models('ordinary')).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect(productCollection.rebuild).not.toHaveBeenCalled();
});
it('allows designated maintainers and uses a food-specific default instruction', async () => {
  const input = productRebuildSchema.parse({ selection: { provider: 'ollama', modelId: 'embed' } });
  await nutritionProductIndex.rebuild('maintainer', input.selection, input.queryInstruction);
  expect(productCollection.rebuild).toHaveBeenCalledWith(
    input.selection,
    'Find foods and food products relevant to the search query.'
  );
});
it('exposes only owner queue status and enqueues retries without model access', async () => {
  (productCollection.status as jest.Mock).mockResolvedValue({ indexed: 1, pending: 1 });
  (prisma.nutritionProductIndexJob.findUnique as jest.Mock).mockResolvedValue({
    revision: 2,
    completedRevision: 1,
    leaseId: null,
    attempts: 1,
    runAfter: new Date(),
    lastError: 'Retry',
  });
  const status = await nutritionProductIndex.status('ordinary');
  expect(status).toMatchObject({
    isMaintainer: false,
    job: { pending: true, running: false, lastError: 'Retry' },
  });
  expect(status.job).not.toHaveProperty('leaseId');
  await nutritionProductIndex.retry('ordinary');
  expect(enqueueProductIndex).toHaveBeenCalledWith(prisma, 'ordinary');
});
