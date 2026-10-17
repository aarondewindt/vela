/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('ai', () => ({ embedMany: jest.fn() }));
jest.mock('@/lib/ai', () => ({
  ...jest.requireActual('@/lib/ai/errors'),
  resolveEmbeddingModelWithIdentity: jest.fn(),
}));
import { embedMany } from 'ai';
import { resolveEmbeddingModelWithIdentity } from '@/lib/ai';
import { embeddingSession, validateVector } from './inference';
const config = {
  provider: 'ollama' as const,
  modelId: 'embed',
  modelDigest: 'old',
  dimensions: 2,
  preparationVersion: 'v1',
  documentPrefix: '',
  queryPrefix: '',
};
beforeEach(() => {
  jest.resetAllMocks();
  (resolveEmbeddingModelWithIdentity as jest.Mock).mockResolvedValue({ model: {}, digest: 'old' });
});
it('rejects model replacement before inference', async () => {
  (resolveEmbeddingModelWithIdentity as jest.Mock).mockResolvedValue({ model: {}, digest: 'new' });
  await expect(embeddingSession(config, config)).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
  });
  expect(embedMany).not.toHaveBeenCalled();
});
it('detects a model changed during inference', async () => {
  const session = await embeddingSession(config);
  (resolveEmbeddingModelWithIdentity as jest.Mock).mockResolvedValue({ model: {}, digest: 'new' });
  await expect(session.verifyIdentity()).rejects.toMatchObject({ code: 'CONFLICT' });
});
it.each([2560, 4096])('supports %i dimensions without a global model limit', async (dimensions) => {
  const vector = Array(dimensions).fill(0.1);
  (embedMany as jest.Mock).mockResolvedValue({ embeddings: [vector] });
  const session = await embeddingSession(config);
  await expect(session.embed(['test'], dimensions)).resolves.toEqual([vector]);
  expect(embedMany).toHaveBeenCalledWith(
    expect.objectContaining({ maxRetries: 0, providerOptions: { ollama: { truncate: false } } })
  );
});
it.each([
  { vector: [] },
  { vector: [NaN] },
  { vector: [Infinity] },
  { vector: [0, 0] },
  { vector: [1] },
  { vector: [Number.MAX_VALUE, 1] },
  { vector: [Number.MIN_VALUE, 0] },
])('rejects invalid, zero or mismatched vectors', ({ vector }) => {
  expect(() => validateVector(vector, 2)).toThrow();
});
it('rejects oversize text without inference and masks provider errors', async () => {
  const session = await embeddingSession(config);
  await expect(session.embed(['x'.repeat(16001)])).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(embedMany).not.toHaveBeenCalled();
  (embedMany as jest.Mock).mockRejectedValue(new Error('private input'));
  await expect(session.embed(['test'])).rejects.toThrow('Embedding generation failed.');
});
