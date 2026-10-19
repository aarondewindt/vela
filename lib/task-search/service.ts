import 'server-only';
import { isEmbeddingMaintainer, requireEmbeddingMaintainer } from '@/lib/embeddings/maintenance';
import { createEmbeddingCollection } from '@/lib/embeddings/collection';
import { discoverModels, type AiModelSelection } from '@/lib/ai';
import { taskEmbeddingAdapter } from './adapter';

const collection = createEmbeddingCollection(taskEmbeddingAdapter);

export const taskSearchService = {
  async status(userId: string) {
    return { ...(await collection.status(userId)), isMaintainer: isEmbeddingMaintainer(userId) };
  },
  async models() {
    return (await discoverModels()).filter((model) => model.capabilities.includes('embedding'));
  },
  synchronize: (userId: string) => collection.synchronize(userId),
  search: (userId: string, query: string, limit: number, signal?: AbortSignal) =>
    collection.search(userId, query, limit, signal),
  async rebuild(userId: string, selection: AiModelSelection, queryInstruction: string) {
    requireEmbeddingMaintainer(userId);
    return collection.rebuild(selection, queryInstruction);
  },
};
