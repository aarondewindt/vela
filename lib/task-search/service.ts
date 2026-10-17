import 'server-only';
import { TRPCError } from '@trpc/server';
import { createEmbeddingCollection } from '@/lib/embeddings/collection';
import { discoverModels, type AiModelSelection } from '@/lib/ai';
import { taskEmbeddingAdapter } from './adapter';

const collection = createEmbeddingCollection(taskEmbeddingAdapter);

async function isMaintainer(userId: string) {
  const allowed = (process.env.EMBEDDING_MAINTAINER_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return allowed.includes(userId);
}

export const taskSearchService = {
  async status(userId: string) {
    return { ...(await collection.status(userId)), isMaintainer: await isMaintainer(userId) };
  },
  async models() {
    return (await discoverModels()).filter((model) => model.capabilities.includes('embedding'));
  },
  synchronize: (userId: string) => collection.synchronize(userId),
  search: (userId: string, query: string, limit: number) => collection.search(userId, query, limit),
  async rebuild(userId: string, selection: AiModelSelection, queryInstruction: string) {
    if (!(await isMaintainer(userId))) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only an embedding maintainer can change models or rebuild the shared collection.',
      });
    }
    return collection.rebuild(selection, queryInstruction);
  },
};
