/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/ai', () => ({ discoverModels: jest.fn() }));
jest.mock('./adapter', () => ({ taskEmbeddingAdapter: {} }));
jest.mock('@/lib/embeddings/collection', () => ({
  createEmbeddingCollection: jest.fn(() => ({
    status: jest.fn(),
    synchronize: jest.fn(),
    search: jest.fn(),
    rebuild: jest.fn(),
  })),
}));
import { taskSearchService } from './service';
import { createEmbeddingCollection } from '@/lib/embeddings/collection';
const engine = (createEmbeddingCollection as jest.Mock).mock.results[0].value;
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
  process.env.EMBEDDING_MAINTAINER_USER_IDS = ' maintainer-a,maintainer-b ';
});
it('denies whole-collection rebuilds for ordinary users before reading other owners', async () => {
  await expect(
    taskSearchService.rebuild('ordinary', { provider: 'ollama', modelId: 'embed' }, '')
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(engine.rebuild).not.toHaveBeenCalled();
});
it('allows explicitly designated maintainers to switch models', async () => {
  await taskSearchService.rebuild(
    'maintainer-a',
    { provider: 'ollama', modelId: 'other-model' },
    'Find tasks'
  );
  expect(engine.rebuild).toHaveBeenCalledWith(
    { provider: 'ollama', modelId: 'other-model' },
    'Find tasks'
  );
});
it('fails closed when the maintainer setting is absent', async () => {
  delete process.env.EMBEDDING_MAINTAINER_USER_IDS;
  await expect(
    taskSearchService.rebuild('maintainer-a', { provider: 'ollama', modelId: 'embed' }, '')
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
