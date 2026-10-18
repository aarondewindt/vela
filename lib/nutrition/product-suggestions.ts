import 'server-only';
import { prisma } from '@/lib/prisma';
import { Prisma } from '../../generated/prisma/client';

export const nutritionSuggestions = {
  async get(userId: string) {
    const [recent, frequent] = await Promise.all(
      (['recent', 'frequent'] as const).map((sort) =>
        prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT p.id FROM nutrition_log_entries l JOIN products p ON p.id = l."productId" AND p."userId" = l."userId"
        WHERE l."userId" = ${userId} AND p."archivedAt" IS NULL GROUP BY p.id
        ORDER BY ${sort === 'frequent' ? Prisma.sql`count(*) DESC,` : Prisma.empty} max(l."logDate") DESC, max(l."createdAt") DESC, p.id
        LIMIT 8
      `)
      )
    );
    // Return small labels only; selecting a suggestion fetches its current definition.
    const ids = [...new Set([...recent, ...frequent].map((row) => row.id))];
    const products = await prisma.product.findMany({
      where: { userId, id: { in: ids }, archivedAt: null },
      select: { id: true, name: true, brand: true },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    const ordered = (rows: { id: string }[]) =>
      rows.flatMap(({ id }) => (byId.has(id) ? [byId.get(id)!] : []));
    return { recent: ordered(recent), frequent: ordered(frequent) };
  },
};
