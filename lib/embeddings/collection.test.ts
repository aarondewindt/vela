/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    embeddingCollectionConfig: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));
jest.mock('./inference', () => ({ embeddingSession: jest.fn() }));
import { prisma } from '@/lib/prisma';
import { embeddingSession } from './inference';
import { createEmbeddingCollection } from './collection';
import type { EmbeddingCollectionAdapter } from './types';

const config = {
  provider: 'ollama' as const,
  modelId: 'embed:1',
  modelDigest: 'digest',
  dimensions: 3,
  preparationVersion: 'v1',
  documentPrefix: '',
  queryPrefix: 'Query: ',
};
const date = new Date('2026-10-17T12:00:00Z');
const doc = { id: 'task-a', text: 'Task A', sourceHash: 'hash-a', updatedAt: date };
const adapter: EmbeddingCollectionAdapter<{ id: string }> = {
  key: 'tasks.test',
  preparationVersion: 'v1',
  documents: jest.fn(),
  stored: jest.fn(),
  clear: jest.fn(),
  write: jest.fn(),
  search: jest.fn(),
};
const session = { digest: 'digest', embed: jest.fn(), verifyIdentity: jest.fn() };
let row: {
  configuration: unknown;
  revision: number;
  leaseId: string | null;
  leaseExpiresAt: Date | null;
  lastError: null;
};
const engine = createEmbeddingCollection(adapter);

beforeEach(() => {
  jest.resetAllMocks();
  row = {
    configuration: config,
    revision: 1,
    leaseId: null,
    leaseExpiresAt: null,
    lastError: null,
  };
  (prisma.embeddingCollectionConfig.findUnique as jest.Mock).mockImplementation(async () => row);
  (prisma.embeddingCollectionConfig.findUniqueOrThrow as jest.Mock).mockImplementation(
    async () => row
  );
  (prisma.embeddingCollectionConfig.updateMany as jest.Mock).mockImplementation(
    async ({ data }) => {
      row = { ...row, ...data };
      return { count: 1 };
    }
  );
  (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn(prisma));
  (adapter.documents as jest.Mock).mockResolvedValue([doc]);
  (adapter.stored as jest.Mock).mockResolvedValue([]);
  (adapter.search as jest.Mock).mockResolvedValue([{ id: doc.id }]);
  (embeddingSession as jest.Mock).mockResolvedValue(session);
  session.embed.mockImplementation(async (texts: string[]) => texts.map(() => [1, 0, 0]));
});

it('indexes only the caller scope and publishes after inference and identity verification', async () => {
  await expect(engine.synchronize('user-a')).resolves.toEqual({ indexed: 1, generated: 1 });
  expect(adapter.documents).toHaveBeenCalledWith(prisma, 'user-a');
  expect(adapter.documents).toHaveBeenCalledWith(prisma, 'user-a', true);
  expect(adapter.stored).toHaveBeenCalledWith(prisma, 'user-a');
  expect(adapter.write).toHaveBeenCalledWith(prisma, [{ document: doc, vector: [1, 0, 0] }]);
  expect(session.verifyIdentity.mock.invocationCallOrder[0]).toBeLessThan(
    (adapter.write as jest.Mock).mock.invocationCallOrder[0]
  );
  expect(adapter.clear).not.toHaveBeenCalled();
});
it('reuses unchanged vectors while refreshing their source timestamp', async () => {
  (adapter.stored as jest.Mock).mockResolvedValue([
    { id: doc.id, sourceHash: doc.sourceHash, sourceUpdatedAt: new Date(0) },
  ]);
  await expect(engine.synchronize('user-a')).resolves.toEqual({ indexed: 1, generated: 0 });
  expect(session.embed).not.toHaveBeenCalled();
  expect(adapter.write).toHaveBeenCalledWith(prisma, [{ document: doc, vector: undefined }]);
});
it('rejects configured staging limits before document inference or publication', async () => {
  for (const limits of [{ maxDocuments: 0 }, { maxVectorValues: 2 }]) {
    const bounded = createEmbeddingCollection({ ...adapter, ...limits });
    await expect(bounded.synchronize('user-a')).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  }
  expect(session.embed).not.toHaveBeenCalled();
  expect(adapter.write).not.toHaveBeenCalled();
});
it('does not publish a task that changed while inference was running', async () => {
  (adapter.documents as jest.Mock)
    .mockResolvedValueOnce([doc])
    .mockResolvedValueOnce([{ ...doc, sourceHash: 'changed' }]);
  await expect(engine.synchronize('user-a')).resolves.toEqual({ indexed: 0, generated: 1 });
  expect(adapter.write).toHaveBeenCalledWith(prisma, []);
});
it('rejects overlapping indexing claims without inference', async () => {
  (prisma.embeddingCollectionConfig.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
  await expect(engine.synchronize('user-a')).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(embeddingSession).not.toHaveBeenCalled();
});
it('keeps the previous index if inference fails', async () => {
  session.embed.mockRejectedValue(new Error('offline'));
  await expect(engine.rebuild(config, '')).rejects.toThrow('offline');
  expect(adapter.clear).not.toHaveBeenCalled();
  expect(adapter.write).not.toHaveBeenCalled();
  expect(prisma.embeddingCollectionConfig.update).not.toHaveBeenCalled();
  expect(prisma.embeddingCollectionConfig.updateMany).toHaveBeenLastCalledWith(
    expect.objectContaining({
      where: { key: adapter.key, leaseId: expect.any(String) },
      data: expect.objectContaining({ leaseId: null }),
    })
  );
});
it('rebuilds all owners and publishes vectors plus one new configuration together', async () => {
  await engine.rebuild({ provider: 'ollama', modelId: 'embed:2' }, 'Find tasks');
  expect(adapter.documents).toHaveBeenCalledWith(prisma);
  expect(adapter.documents).toHaveBeenCalledWith(prisma, undefined, true);
  expect(adapter.clear).toHaveBeenCalledWith(prisma);
  expect(prisma.embeddingCollectionConfig.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        configuration: expect.objectContaining({
          modelId: 'embed:2',
          dimensions: 3,
          queryPrefix: 'Instruct: Find tasks\nQuery: ',
        }),
        revision: { increment: 1 },
      }),
    })
  );
});
it('retains the old collection if sources changed during a full rebuild', async () => {
  (adapter.documents as jest.Mock).mockResolvedValueOnce([doc]).mockResolvedValueOnce([]);
  await expect(engine.rebuild(config, '')).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(adapter.clear).not.toHaveBeenCalled();
});
it('fences late publishers with an expired or superseded lease', async () => {
  session.verifyIdentity.mockImplementation(async () => {
    row.leaseId = 'newer-attempt';
  });
  await expect(engine.synchronize('user-a')).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(adapter.write).not.toHaveBeenCalled();
});
it('rejects search when there is no active configuration', async () => {
  row.configuration = null;
  await expect(engine.search('user-a', 'test', 10)).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
  });
  expect(embeddingSession).not.toHaveBeenCalled();
});
it('uses the saved configuration and passes ownership to exact search', async () => {
  await engine.search('user-a', 'test', 10);
  expect(embeddingSession).toHaveBeenCalledWith(config, config, undefined);
  expect(session.embed).toHaveBeenCalledWith(['Query: test'], 3);
  expect(adapter.search).toHaveBeenCalledWith(prisma, 'user-a', [1, 0, 0], 10);
});
it('rejects a search if the collection changed during inference', async () => {
  session.verifyIdentity.mockImplementation(async () => {
    row = { ...row, revision: 2 };
  });
  await expect(engine.search('user-a', 'test', 10)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(adapter.search).not.toHaveBeenCalled();
});
it('reports freshness using both source hashes and timestamps', async () => {
  (adapter.stored as jest.Mock).mockResolvedValue([
    { id: doc.id, sourceHash: doc.sourceHash, sourceUpdatedAt: new Date(0) },
  ]);
  await expect(engine.status('user-a')).resolves.toMatchObject({
    total: 1,
    indexed: 0,
    pending: 1,
  });
});
