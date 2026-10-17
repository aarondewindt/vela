/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/ai', () => ({
  ...jest.requireActual('@/lib/ai/errors'),
  discoverModels: jest.fn(),
  resolveEmbeddingModel: jest.fn(),
}));
jest.mock('ai', () => ({
  embed: jest.fn(),
  embedMany: jest.fn(),
  cosineSimilarity: jest.fn(),
  APICallError: { isInstance: (error: { name?: string }) => error?.name === 'APICallError' },
}));

import { cosineSimilarity, embed, embedMany } from 'ai';
import { AiError, discoverModels, resolveEmbeddingModel } from '@/lib/ai';
import { embeddingService } from './embeddings';

const selection = { provider: 'ollama' as const, modelId: 'embedding:latest' };
const model = { modelId: selection.modelId };
const first = Array.from({ length: 32 }, (_, index) => index / 32);
const second = first.map((value) => -value);

beforeEach(() => {
  jest.resetAllMocks();
  (resolveEmbeddingModel as jest.Mock).mockResolvedValue(model);
  (embed as jest.Mock).mockResolvedValue({ embedding: first });
  (embedMany as jest.Mock).mockResolvedValue({ embeddings: [first, second] });
  (cosineSimilarity as jest.Mock).mockReturnValue(-1);
});

describe('embeddingService', () => {
  it('lists only embedding-capable models, including dual-capability models', async () => {
    const embedding = { id: 'embed', capabilities: ['embedding'] };
    const both = { id: 'both', capabilities: ['chat', 'embedding'] };
    (discoverModels as jest.Mock).mockResolvedValue([
      { id: 'chat', capabilities: ['chat'] },
      embedding,
      both,
      { id: 'unknown', capabilities: [] },
    ]);
    await expect(embeddingService.listModels()).resolves.toEqual([embedding, both]);
  });
  it('embeds exact text with the explicitly resolved model and returns only a preview', async () => {
    await expect(embeddingService.generate({ selection, text: ' Hello\n' })).resolves.toEqual({
      selection,
      dimensions: 32,
      preview: first.slice(0, 16),
    });
    expect(resolveEmbeddingModel).toHaveBeenCalledWith(selection);
    expect(embed).toHaveBeenCalledWith({
      model,
      value: ' Hello\n',
      maxRetries: 0,
      abortSignal: expect.any(AbortSignal),
      providerOptions: { ollama: { truncate: false } },
    });
  });
  it('embeds both texts together and compares complete vectors from the same model', async () => {
    await expect(
      embeddingService.compare({ selection, textA: 'A', textB: 'B' })
    ).resolves.toMatchObject({
      selection,
      similarity: -1,
      first: { dimensions: 32 },
      second: { dimensions: 32 },
    });
    expect(resolveEmbeddingModel).toHaveBeenCalledTimes(1);
    expect(embedMany).toHaveBeenCalledWith({
      model,
      values: ['A', 'B'],
      maxRetries: 0,
      abortSignal: expect.any(AbortSignal),
      providerOptions: { ollama: { truncate: false } },
    });
    expect(cosineSimilarity).toHaveBeenCalledWith(first, second);
  });
  it('clamps floating point rounding at the similarity bounds', async () => {
    (cosineSimilarity as jest.Mock).mockReturnValue(1.0000000000000002);
    await expect(
      embeddingService.compare({ selection, textA: 'A', textB: 'A' })
    ).resolves.toMatchObject({ similarity: 1 });
  });
  it.each([undefined, [], [NaN], [Infinity]])('rejects malformed vectors', async (embedding) => {
    (embed as jest.Mock).mockResolvedValue({ embedding });
    await expect(embeddingService.generate({ selection, text: 'A' })).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESPONSE',
    });
  });
  it.each([
    { embeddings: [] },
    { embeddings: [first] },
    { embeddings: [first, [1, 2]] },
    { embeddings: [first, Array(32).fill(0)] },
  ])('rejects invalid comparison vectors', async ({ embeddings }) => {
    (embedMany as jest.Mock).mockResolvedValue({ embeddings });
    await expect(
      embeddingService.compare({ selection, textA: 'A', textB: 'B' })
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    expect(cosineSimilarity).not.toHaveBeenCalled();
  });
  it('rejects non-finite similarity', async () => {
    (cosineSimilarity as jest.Mock).mockReturnValue(NaN);
    await expect(
      embeddingService.compare({ selection, textA: 'A', textB: 'B' })
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  });
  it('preserves safe selection errors without calling inference', async () => {
    const error = new AiError('MODEL_NOT_SUPPORTED', 'Select an embedding model.');
    (resolveEmbeddingModel as jest.Mock).mockRejectedValue(error);
    await expect(embeddingService.generate({ selection, text: 'A' })).rejects.toBe(error);
    expect(embed).not.toHaveBeenCalled();
  });
  it('reports rejected inputs without exposing provider payloads', async () => {
    (embed as jest.Mock).mockRejectedValue({
      name: 'APICallError',
      statusCode: 400,
      message: 'private input',
    });
    await expect(embeddingService.generate({ selection, text: 'A' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Ollama rejected the embedding input. Try shorter text.',
    });
  });
  it.each(['generate', 'compare'] as const)('masks inference failures from %s', async (method) => {
    (embed as jest.Mock).mockRejectedValue(new Error('private input'));
    (embedMany as jest.Mock).mockRejectedValue(new Error('private input'));
    const promise =
      method === 'generate'
        ? embeddingService.generate({ selection, text: 'A' })
        : embeddingService.compare({ selection, textA: 'A', textB: 'B' });
    await expect(promise).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Embedding generation failed. Check Ollama and try again.',
    });
  });
});
