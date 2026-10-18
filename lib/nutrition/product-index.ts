import 'server-only';
import { createEmbeddingCollection } from '@/lib/embeddings/collection';
import { discoverModels, type AiModelSelection } from '@/lib/ai';
import { isEmbeddingMaintainer, requireEmbeddingMaintainer } from '@/lib/embeddings/maintenance';
import { prisma } from '@/lib/prisma';
import { productEmbeddingAdapter } from './product-embedding-adapter';
import { enqueueProductIndex } from './product-index-queue';

export const productCollection = createEmbeddingCollection(productEmbeddingAdapter);

export const nutritionProductIndex = {
  async status(userId: string) {
    const [status, job] = await Promise.all([
      productCollection.status(userId),
      prisma.nutritionProductIndexJob.findUnique({ where: { userId } }),
    ]);
    return {
      ...status,
      isMaintainer: isEmbeddingMaintainer(userId),
      job: job
        ? {
            pending: job.revision > job.completedRevision,
            running: Boolean(job.leaseId && job.leaseExpiresAt && job.leaseExpiresAt > new Date()),
            attempts: job.attempts,
            runAfter: job.runAfter,
            lastError: job.lastError,
          }
        : null,
    };
  },
  async retry(userId: string) {
    await enqueueProductIndex(prisma, userId);
    return { queued: true };
  },
  async models(userId: string) {
    requireEmbeddingMaintainer(userId);
    return (await discoverModels()).filter((model) => model.capabilities.includes('embedding'));
  },
  async rebuild(userId: string, selection: AiModelSelection, queryInstruction: string) {
    requireEmbeddingMaintainer(userId);
    return productCollection.rebuild(selection, queryInstruction);
  },
};
