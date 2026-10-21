import 'server-only';
import { Prisma } from '../../generated/prisma/client';
import type { EmbeddingCollectionAdapter } from '@/lib/embeddings/types';
import { taskEmbeddingDocument } from './text';

export type TaskSearchResult = {
  id: string;
  title: string;
  brief: string | null;
  status: string;
  similarity: number;
};

export const taskEmbeddingAdapter: EmbeddingCollectionAdapter<TaskSearchResult> = {
  key: 'tasks.semantic',
  preparationVersion: 'task-text-v1',
  async documents(db, userId, lock) {
    if (lock) {
      await db.$queryRaw(
        Prisma.sql`SELECT id FROM tasks ${userId ? Prisma.sql`WHERE "userId" = ${userId}` : Prisma.empty} ORDER BY id FOR SHARE`
      );
    }
    const tasks = await db.task.findMany({
      where: userId ? { userId } : {},
      select: {
        id: true,
        title: true,
        brief: true,
        firstStep: true,
        tags: true,
        content: true,
        updatedAt: true,
      },
      orderBy: { id: 'asc' },
    });
    return tasks.map(taskEmbeddingDocument);
  },
  stored(db, userId) {
    return db.$queryRaw(Prisma.sql`SELECT e."taskId" AS id, e."sourceHash", e."sourceUpdatedAt"
      FROM task_embeddings e JOIN tasks t ON t.id = e."taskId"
      ${userId ? Prisma.sql`WHERE t."userId" = ${userId}` : Prisma.empty}`);
  },
  async clear(db, userId) {
    await db.$executeRaw(Prisma.sql`DELETE FROM task_embeddings e USING tasks t WHERE e."taskId" = t.id
      ${userId ? Prisma.sql`AND t."userId" = ${userId}` : Prisma.empty}`);
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
      await db.$executeRaw(Prisma.sql`INSERT INTO task_embeddings ("taskId", embedding, "sourceHash", "sourceUpdatedAt", "indexedAt")
        VALUES ${Prisma.join(values)} ON CONFLICT ("taskId") DO UPDATE SET embedding = EXCLUDED.embedding,
        "sourceHash" = EXCLUDED."sourceHash", "sourceUpdatedAt" = EXCLUDED."sourceUpdatedAt", "indexedAt" = EXCLUDED."indexedAt"`);
    }
    for (const { document } of records.filter((record) => !record.vector)) {
      await db.$executeRaw`UPDATE task_embeddings SET "sourceUpdatedAt" = ${document.updatedAt}
        WHERE "taskId" = ${document.id}::uuid AND "sourceHash" = ${document.sourceHash}`;
    }
  },
  search(db, userId, vector, limit, allowedIds) {
    return db.$queryRaw<
      TaskSearchResult[]
    >(Prisma.sql`SELECT t.id, t.title, t.brief, t.status::text,
      greatest(-1, least(1, 1 - (e.embedding <=> ${JSON.stringify(vector)}::vector)))::double precision AS similarity
      FROM task_embeddings e JOIN tasks t ON t.id = e."taskId"
      WHERE t."userId" = ${userId} AND e."sourceUpdatedAt" = t."updatedAt"
      ${allowedIds ? (allowedIds.length ? Prisma.sql`AND t.id IN (${Prisma.join(allowedIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.sql`AND FALSE`) : Prisma.empty}
      ORDER BY e.embedding <=> ${JSON.stringify(vector)}::vector, t.id LIMIT ${limit}`);
  },
};
