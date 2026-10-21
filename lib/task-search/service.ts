import 'server-only';
import { AiError } from '@/lib/ai/errors';
import { EmbeddingCollectionError } from '@/lib/embeddings/errors';
import { prisma } from '@/lib/prisma';
import { isEmbeddingMaintainer, requireEmbeddingMaintainer } from '@/lib/embeddings/maintenance';
import { createEmbeddingCollection } from '@/lib/embeddings/collection';
import { discoverModels, type AiModelSelection } from '@/lib/ai';
import { taskEmbeddingAdapter } from './adapter';

export const taskCollection = createEmbeddingCollection(taskEmbeddingAdapter);

export const taskSearchService = {
  async related(userId: string, query: string, limit: number) {
    try {
      const result = await taskCollection.search(userId, query, limit, AbortSignal.timeout(12000));
      return { ids: result.results.map((match) => match.id), notice: null };
    } catch (error) {
      if (!(error instanceof AiError || error instanceof EmbeddingCollectionError)) {
        throw error;
      }
      return {
        ids: [] as string[],
        notice: 'Semantic search is unavailable. Showing text matches.',
      };
    }
  },
  async status(userId: string) {
    const [status, job] = await Promise.all([
      taskCollection.status(userId),
      prisma.taskIndexJob.findUnique({ where: { userId } }),
    ]);
    return {
      ...status,
      isMaintainer: isEmbeddingMaintainer(userId),
      job: job
        ? {
            pending: job.revision > job.completedRevision,
            running: Boolean(job.leaseId && job.leaseExpiresAt && job.leaseExpiresAt > new Date()),
            lastError: job.lastError,
            runAfter: job.runAfter,
          }
        : null,
    };
  },
  async models() {
    return (await discoverModels()).filter((model) => model.capabilities.includes('embedding'));
  },
  synchronize: (userId: string) => taskCollection.synchronize(userId),
  search: (userId: string, query: string, limit: number, signal?: AbortSignal) =>
    taskCollection.search(userId, query, limit, signal),
  async rebuild(userId: string, selection: AiModelSelection, queryInstruction: string) {
    requireEmbeddingMaintainer(userId);
    return taskCollection.rebuild(selection, queryInstruction);
  },
};
