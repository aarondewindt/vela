import 'server-only';
import { Prisma } from '../../generated/prisma/client';
import type { EmbeddingCollectionAdapter } from '@/lib/embeddings/types';
import { EmbeddingCollectionError } from '@/lib/embeddings/errors';
import { productEmbeddingDocument } from './product-embedding-text';

export type SemanticProductMatch = { id: string; similarity: number };

export const productEmbeddingAdapter: EmbeddingCollectionAdapter<SemanticProductMatch> = {
  key: 'nutrition.products.semantic',
  preparationVersion: 'product-text-v1',
  maxDocuments: 10_000,
  maxVectorValues: 12_000_000,
  async documents(db, userId, lock) {
    if (lock) {
      await db.$queryRaw(Prisma.sql`SELECT id FROM products WHERE "archivedAt" IS NULL
        ${userId ? Prisma.sql`AND "userId" = ${userId}` : Prisma.empty} ORDER BY id FOR SHARE`);
    }
    const products = await db.product.findMany({
      where: { archivedAt: null, ...(userId ? { userId } : {}) },
      select: {
        id: true,
        name: true,
        brand: true,
        description: true,
        aliases: true,
        searchUpdatedAt: true,
      },
      orderBy: { id: 'asc' },
      take: 10_001,
    });
    if (products.length > 10_000) {
      throw new EmbeddingCollectionError(
        'PRECONDITION_FAILED',
        'Product indexing supports up to 10,000 active products per operation. Reduce the active catalog.'
      );
    }
    return products.map(productEmbeddingDocument);
  },
  stored(db, userId) {
    return db.$queryRaw(Prisma.sql`SELECT e."productId" AS id, e."sourceHash", e."sourceUpdatedAt"
      FROM product_embeddings e JOIN products p ON p.id = e."productId"
      WHERE p."archivedAt" IS NULL ${userId ? Prisma.sql`AND p."userId" = ${userId}` : Prisma.empty}`);
  },
  async clear(db, userId) {
    await db.$executeRaw(Prisma.sql`DELETE FROM product_embeddings e USING products p
      WHERE e."productId" = p.id ${userId ? Prisma.sql`AND p."userId" = ${userId}` : Prisma.empty}`);
  },
  async write(db, records) {
    const generated = records.filter((record) => record.vector);
    for (let offset = 0; offset < generated.length; offset += 100) {
      const values = generated
        .slice(offset, offset + 100)
        .map(
          ({ document, vector }) =>
            Prisma.sql`(${document.id}::uuid, ${JSON.stringify(vector)}::vector, ${document.sourceHash}, ${document.updatedAt}, CURRENT_TIMESTAMP)`
        );
      await db.$executeRaw(Prisma.sql`INSERT INTO product_embeddings
        ("productId", embedding, "sourceHash", "sourceUpdatedAt", "indexedAt") VALUES ${Prisma.join(values)}
        ON CONFLICT ("productId") DO UPDATE SET embedding = EXCLUDED.embedding,
        "sourceHash" = EXCLUDED."sourceHash", "sourceUpdatedAt" = EXCLUDED."sourceUpdatedAt", "indexedAt" = EXCLUDED."indexedAt"`);
    }
    for (const { document } of records.filter((record) => !record.vector)) {
      await db.$executeRaw`UPDATE product_embeddings SET "sourceUpdatedAt" = ${document.updatedAt}
        WHERE "productId" = ${document.id}::uuid AND "sourceHash" = ${document.sourceHash}`;
    }
  },
  search(db, userId, vector, limit) {
    return db.$queryRaw<SemanticProductMatch[]>`SELECT p.id,
      greatest(-1, least(1, 1 - (e.embedding <=> ${JSON.stringify(vector)}::vector)))::double precision AS similarity
      FROM product_embeddings e JOIN products p ON p.id = e."productId"
      WHERE p."userId" = ${userId} AND p."archivedAt" IS NULL AND e."sourceUpdatedAt" = p."searchUpdatedAt"
      ORDER BY e.embedding <=> ${JSON.stringify(vector)}::vector, p.id LIMIT ${limit}`;
  },
};
