import 'server-only';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { AiModelSelection } from '@/lib/ai';
import { configurationSchema } from './schema';
import { EmbeddingCollectionError } from './errors';
import { embeddingSession } from './inference';
import type {
  EmbeddingCollectionAdapter,
  EmbeddingConfiguration,
  EmbeddingDocument,
  EmbeddingWrite,
} from './types';
import type { Prisma } from '../../generated/prisma/client';

const leaseMs = 300_000;
const batchSize = 8;

function configuration(value: unknown, preparationVersion: string) {
  const parsed = configurationSchema.safeParse(value);
  if (!parsed.success || parsed.data.preparationVersion !== preparationVersion) {
    throw new EmbeddingCollectionError(
      'PRECONDITION_FAILED',
      'This collection needs a maintainer rebuild before it can be used.'
    );
  }
  return parsed.data;
}

export function createEmbeddingCollection<Result>(adapter: EmbeddingCollectionAdapter<Result>) {
  async function claim() {
    await prisma.embeddingCollectionConfig.upsert({
      where: { key: adapter.key },
      create: { key: adapter.key },
      update: {},
    });
    const leaseId = randomUUID();
    const claimed = await prisma.embeddingCollectionConfig.updateMany({
      where: { key: adapter.key, OR: [{ leaseId: null }, { leaseExpiresAt: { lt: new Date() } }] },
      data: { leaseId, leaseExpiresAt: new Date(Date.now() + leaseMs), lastError: null },
    });
    if (!claimed.count) {
      throw new EmbeddingCollectionError(
        'CONFLICT',
        'This collection is already being indexed. Retry after it finishes.'
      );
    }
    return leaseId;
  }

  async function renew(leaseId: string) {
    const result = await prisma.embeddingCollectionConfig.updateMany({
      where: { key: adapter.key, leaseId, leaseExpiresAt: { gt: new Date() } },
      data: { leaseExpiresAt: new Date(Date.now() + leaseMs) },
    });
    if (!result.count) {
      throw new EmbeddingCollectionError('CONFLICT', 'The indexing lease expired. Retry indexing.');
    }
  }

  async function lock(db: Prisma.TransactionClient, leaseId?: string) {
    await db.$queryRaw`SELECT key FROM embedding_collection_configs WHERE key = ${adapter.key} FOR UPDATE`;
    const row = await db.embeddingCollectionConfig.findUniqueOrThrow({
      where: { key: adapter.key },
    });
    if (
      leaseId &&
      (row.leaseId !== leaseId || !row.leaseExpiresAt || row.leaseExpiresAt.getTime() <= Date.now())
    ) {
      throw new EmbeddingCollectionError(
        'CONFLICT',
        'This indexing attempt was superseded. Retry indexing.'
      );
    }
    return row;
  }

  async function run<T>(operation: (leaseId: string) => Promise<T>) {
    const leaseId = await claim();
    try {
      return await operation(leaseId);
    } catch (error) {
      await prisma.embeddingCollectionConfig.updateMany({
        where: { key: adapter.key, leaseId },
        data: {
          leaseId: null,
          leaseExpiresAt: null,
          lastError:
            'Indexing failed. The previously published vectors and configuration were retained.',
        },
      });
      throw error;
    }
  }

  async function vectorsFor(
    documents: EmbeddingDocument[],
    config: EmbeddingConfiguration,
    session: Awaited<ReturnType<typeof embeddingSession>>,
    leaseId: string
  ) {
    if (
      (adapter.maxDocuments !== undefined && documents.length > adapter.maxDocuments) ||
      (adapter.maxVectorValues !== undefined &&
        documents.length * config.dimensions > adapter.maxVectorValues)
    ) {
      throw new EmbeddingCollectionError(
        'PRECONDITION_FAILED',
        'This collection exceeds its in-memory indexing limit. Use a smaller model or reduce the active catalog.'
      );
    }
    const records: EmbeddingWrite[] = [];
    for (let offset = 0; offset < documents.length; offset += batchSize) {
      await renew(leaseId);
      const batch = documents.slice(offset, offset + batchSize);
      const vectors = await session.embed(
        batch.map((doc) => config.documentPrefix + doc.text),
        config.dimensions
      );
      records.push(...batch.map((document, index) => ({ document, vector: vectors[index] })));
    }
    await session.verifyIdentity();
    return records;
  }

  return {
    async status(userId: string) {
      const [row, documents, stored] = await Promise.all([
        prisma.embeddingCollectionConfig.findUnique({ where: { key: adapter.key } }),
        adapter.documents(prisma, userId),
        adapter.stored(prisma, userId),
      ]);
      const byId = new Map(stored.map((entry) => [entry.id, entry]));
      const indexed = documents.filter((doc) => {
        const entry = byId.get(doc.id);
        return (
          entry?.sourceHash === doc.sourceHash &&
          entry.sourceUpdatedAt.getTime() === doc.updatedAt.getTime()
        );
      }).length;
      const parsed = configurationSchema.safeParse(row?.configuration);
      return {
        key: adapter.key,
        configuration: parsed.success ? parsed.data : null,
        busy: Boolean(
          row?.leaseId && row.leaseExpiresAt && row.leaseExpiresAt.getTime() > Date.now()
        ),
        lastError: row?.lastError ?? null,
        total: documents.length,
        indexed,
        pending: documents.length - indexed,
      };
    },

    /** Ordinary users refresh only their own rows under the existing configuration. */
    async synchronize(userId: string) {
      return run(async (leaseId) => {
        const row = await prisma.embeddingCollectionConfig.findUniqueOrThrow({
          where: { key: adapter.key },
        });
        const config = configuration(row.configuration, adapter.preparationVersion);
        const session = await embeddingSession(config, config);
        const [documents, stored] = await Promise.all([
          adapter.documents(prisma, userId),
          adapter.stored(prisma, userId),
        ]);
        const byId = new Map(stored.map((entry) => [entry.id, entry]));
        const changed = documents.filter((doc) => byId.get(doc.id)?.sourceHash !== doc.sourceHash);
        const generated = await vectorsFor(changed, config, session, leaseId);
        const byGeneratedId = new Map(generated.map((entry) => [entry.document.id, entry]));
        const indexed = await prisma.$transaction(
          async (db) => {
            await lock(db, leaseId);
            const current = new Map(
              (await adapter.documents(db, userId, true)).map((doc) => [doc.id, doc])
            );
            const records = documents.flatMap((doc) => {
              const latest = current.get(doc.id);
              return latest?.sourceHash === doc.sourceHash
                ? [{ document: latest, vector: byGeneratedId.get(doc.id)?.vector }]
                : [];
            });
            await adapter.write(db, records);
            await db.embeddingCollectionConfig.update({
              where: { key: adapter.key },
              data: { leaseId: null, leaseExpiresAt: null, lastError: null },
            });
            return records.length;
          },
          { timeout: 30_000 }
        );
        return { indexed, generated: generated.length };
      });
    },

    /** Maintenance-only: rebuild EVERY source row before atomic replacement. */
    async rebuild(selection: AiModelSelection, queryInstruction: string) {
      return run(async (leaseId) => {
        const session = await embeddingSession(selection);
        const [probe] = await session.embed(['Embedding dimension probe.']);
        const config: EmbeddingConfiguration = {
          ...selection,
          modelDigest: session.digest,
          dimensions: probe.length,
          preparationVersion: adapter.preparationVersion,
          documentPrefix: '',
          queryPrefix: queryInstruction ? `Instruct: ${queryInstruction}\nQuery: ` : '',
        };
        const documents = await adapter.documents(prisma);
        const records = await vectorsFor(documents, config, session, leaseId);
        await prisma.$transaction(
          async (db) => {
            await lock(db, leaseId);
            const current = await adapter.documents(db, undefined, true);
            const byId = new Map(current.map((doc) => [doc.id, doc]));
            if (
              current.length !== documents.length ||
              documents.some((doc) => byId.get(doc.id)?.sourceHash !== doc.sourceHash)
            ) {
              throw new EmbeddingCollectionError(
                'CONFLICT',
                'Source records changed during the rebuild. The previous index was retained; retry rebuilding.'
              );
            }
            await adapter.clear(db);
            await adapter.write(
              db,
              records.map((record) => ({ ...record, document: byId.get(record.document.id)! }))
            );
            await db.embeddingCollectionConfig.update({
              where: { key: adapter.key },
              data: {
                configuration: config,
                revision: { increment: 1 },
                leaseId: null,
                leaseExpiresAt: null,
                lastError: null,
              },
            });
          },
          { timeout: 30_000 }
        );
        return { indexed: records.length, configuration: config };
      });
    },

    async search(
      userId: string,
      query: string,
      limit: number,
      signal?: AbortSignal,
      allowedIds?: string[]
    ) {
      const row = await prisma.embeddingCollectionConfig.findUnique({
        where: { key: adapter.key },
      });
      const config = configuration(row?.configuration, adapter.preparationVersion);
      const session = await embeddingSession(config, config, signal);
      const [vector] = await session.embed([config.queryPrefix + query], config.dimensions);
      await session.verifyIdentity();
      const results = await prisma.$transaction(async (db) => {
        const current = await lock(db);
        if (current.revision !== row!.revision) {
          throw new EmbeddingCollectionError(
            'CONFLICT',
            'The collection changed during the search. Search again.'
          );
        }
        return adapter.search(db, userId, vector, limit, allowedIds);
      });
      return { results, configuration: config };
    },
  };
}
