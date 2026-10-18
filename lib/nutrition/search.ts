import 'server-only';
import { Prisma } from '../../generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { normalizeProductText } from './normalization';
import type { ProductSearchInput } from './schema';

export async function searchProductIds(userId: string, input: ProductSearchInput) {
  const query = normalizeProductText(input.query);
  const where = Prisma.sql`p."userId" = ${userId}
    AND ${input.archived ? Prisma.sql`p."archivedAt" IS NOT NULL` : Prisma.sql`p."archivedAt" IS NULL`}
    AND (${query} = '' OR position(${query} in p."searchText") > 0)`;
  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT p.id FROM products p WHERE ${where}
      ORDER BY CASE WHEN p."normalizedName" = ${query} THEN 0
        WHEN ${query} = ANY(p."normalizedAliases") THEN 1 ELSE 2 END,
        p."normalizedName", p.id
      LIMIT ${input.limit} OFFSET ${input.offset}`),
    prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
      SELECT count(*)::int AS total FROM products p WHERE ${where}`),
  ]);
  return { ids: rows.map((row) => row.id), total: counts[0].total };
}
