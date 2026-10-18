import 'server-only';

import { APICallError, cosineSimilarity, embed, embedMany } from 'ai';
import { TRPCError } from '@trpc/server';
import { AiError, discoverModels, resolveEmbeddingModel } from '@/lib/ai';
import type { ComparisonInput, EmbeddingInput } from './schema';
import type { ModelSelection } from '@/lib/model-settings/schema';
import { requireModelSelection } from '@/lib/model-settings/service';

function inspectVector(vector: number[]) {
  if (!Array.isArray(vector) || !vector.length || !vector.every(Number.isFinite)) {
    throw new AiError('INVALID_PROVIDER_RESPONSE', 'Ollama returned an invalid embedding vector.');
  }
  return { dimensions: vector.length, preview: vector.slice(0, 16) };
}

async function infer<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (APICallError.isInstance(error) && error.statusCode === 400) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Ollama rejected the embedding input. Try shorter text.',
      });
    }
    throw new AiError(
      'PROVIDER_UNAVAILABLE',
      'Embedding generation failed. Check Ollama and try again.'
    );
  }
}

export const embeddingService = {
  async generateForUser(userId: string, input: EmbeddingInput) {
    return embeddingService.generate({
      ...input,
      selection: await requireModelSelection(userId, 'aiDev.embeddings', input.selection),
    });
  },
  async compareForUser(userId: string, input: ComparisonInput) {
    return embeddingService.compare({
      ...input,
      selection: await requireModelSelection(userId, 'aiDev.embeddings', input.selection),
    });
  },
  async listModels() {
    const models = await discoverModels();
    return models.filter((model) => model.capabilities.includes('embedding'));
  },

  async generate({
    selection,
    text,
  }: Omit<EmbeddingInput, 'selection'> & { selection: ModelSelection }) {
    const model = await resolveEmbeddingModel(selection);
    const { embedding } = await infer(() =>
      embed({
        model,
        value: text,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(120_000),
        providerOptions: { ollama: { truncate: false } },
      })
    );
    return { selection, ...inspectVector(embedding) };
  },

  async compare({
    selection,
    textA,
    textB,
  }: Omit<ComparisonInput, 'selection'> & { selection: ModelSelection }) {
    const model = await resolveEmbeddingModel(selection);
    const { embeddings } = await infer(() =>
      embedMany({
        model,
        values: [textA, textB],
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(120_000),
        providerOptions: { ollama: { truncate: false } },
      })
    );
    if (embeddings.length !== 2) {
      throw new AiError('INVALID_PROVIDER_RESPONSE', 'Ollama returned an invalid embedding count.');
    }
    const [vectorA, vectorB] = embeddings;
    const first = inspectVector(vectorA);
    const second = inspectVector(vectorB);
    if (
      first.dimensions !== second.dimensions ||
      !vectorA.some((value) => value !== 0) ||
      !vectorB.some((value) => value !== 0)
    ) {
      throw new AiError(
        'INVALID_PROVIDER_RESPONSE',
        'Ollama returned vectors that cannot be compared.'
      );
    }
    const similarity = cosineSimilarity(vectorA, vectorB);
    if (!Number.isFinite(similarity)) {
      throw new AiError('INVALID_PROVIDER_RESPONSE', 'The embedding similarity is invalid.');
    }
    return {
      selection,
      first,
      second,
      // Floating point rounding can put identical vectors just above 1.
      similarity: Math.max(-1, Math.min(1, similarity)),
    };
  },
};
