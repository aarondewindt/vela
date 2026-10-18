import 'server-only';
import { embedMany } from 'ai';
import { AiError, resolveEmbeddingModelWithIdentity, type AiModelSelection } from '@/lib/ai';
import { EmbeddingCollectionError } from './errors';
import type { EmbeddingConfiguration } from './types';

export function validateVector(vector: number[], dimensions?: number) {
  if (
    !Array.isArray(vector) ||
    !vector.length ||
    vector.length > 16_000 ||
    !vector.every((value) => Number.isFinite(value) && Number.isFinite(Math.fround(value))) ||
    !vector.some((value) => Math.fround(value) !== 0) ||
    (dimensions !== undefined && vector.length !== dimensions)
  ) {
    throw new AiError(
      'INVALID_PROVIDER_RESPONSE',
      'The embedding vector is invalid or has unexpected dimensions.'
    );
  }
}

export async function embeddingSession(
  selection: AiModelSelection,
  expected?: EmbeddingConfiguration,
  signal?: AbortSignal
) {
  const resolved = await resolveEmbeddingModelWithIdentity(selection, signal);
  if (expected && resolved.digest !== expected.modelDigest) {
    throw new EmbeddingCollectionError(
      'PRECONDITION_FAILED',
      'The installed model has changed. A maintainer must rebuild the entire collection.'
    );
  }
  return {
    digest: resolved.digest,
    async embed(texts: string[], dimensions = expected?.dimensions) {
      if (texts.some((text) => !text.trim() || text.length > 16_000)) {
        throw new EmbeddingCollectionError(
          'BAD_REQUEST',
          'An embedding input is empty or exceeds 16,000 characters.'
        );
      }
      let vectors: number[][];
      try {
        vectors = (
          await embedMany({
            model: resolved.model,
            values: texts,
            maxRetries: 0,
            abortSignal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
              : AbortSignal.timeout(120_000),
            providerOptions: { ollama: { truncate: false } },
          })
        ).embeddings;
      } catch {
        throw new AiError(
          'PROVIDER_UNAVAILABLE',
          'Embedding generation failed. Check Ollama and the model context limit, then retry.'
        );
      }
      if (!Array.isArray(vectors) || vectors.length !== texts.length) {
        throw new AiError(
          'INVALID_PROVIDER_RESPONSE',
          'Ollama returned an unexpected number of embeddings.'
        );
      }
      vectors.forEach((vector) => validateVector(vector, dimensions));
      return vectors;
    },
    async verifyIdentity() {
      const current = await resolveEmbeddingModelWithIdentity(selection, signal);
      if (current.digest !== resolved.digest) {
        throw new EmbeddingCollectionError(
          'CONFLICT',
          'The model changed during inference. No vectors were published; retry the operation.'
        );
      }
    },
  };
}
