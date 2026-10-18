import 'server-only';
import { prisma } from '@/lib/prisma';
import { AiError } from '@/lib/ai/errors';
import { EmbeddingCollectionError } from '@/lib/embeddings/errors';
import { productCollection } from './product-index';
import { searchProductIds } from './search';
import { normalizeProductText } from './normalization';
import type { HybridProductSearchInput } from './product-search-schema';
import type { SemanticProductMatch } from './product-embedding-adapter';

export type ProductMatch = {
  id: string;
  kind: 'name' | 'alias' | 'text' | 'semantic';
  similarity: number | null;
};

/** Exact identities stay first; callers can prioritize related foods over substring matches. */
export async function searchHybridProductIds(
  userId: string,
  input: HybridProductSearchInput,
  signal?: AbortSignal
) {
  const query = normalizeProductText(input.query);
  const text = await searchProductIds(userId, {
    query,
    archived: false,
    limit: input.limit,
    offset: 0,
  });
  const rows = await prisma.product.findMany({
    where: { userId, archivedAt: null, id: { in: text.ids } },
    select: { id: true, normalizedName: true, normalizedAliases: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const matches: ProductMatch[] = text.ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) {
      return [];
    }
    const kind =
      query && row.normalizedName === query
        ? 'name'
        : query && row.normalizedAliases.includes(query)
          ? 'alias'
          : 'text';
    return [{ id, kind, similarity: null }];
  });
  let semantic: 'off' | 'available' | 'unavailable' = 'off';
  let notice: string | null = null;
  if (query && input.semantic) {
    try {
      const found = await productCollection.search(
        userId,
        query,
        input.limit,
        signal
          ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
          : AbortSignal.timeout(12_000)
      );
      semantic = 'available';
      const semanticById = new Map<string, SemanticProductMatch>(
        found.results.map((match) => [match.id, match])
      );
      for (const match of matches) {
        match.similarity = semanticById.get(match.id)?.similarity ?? null;
      }
      // Keep the complete semantic pool until ranking: a full text page must not crowd it out.
      const textById = new Map(matches.map((match) => [match.id, match]));
      const ranked =
        input.ranking === 'related-first'
          ? matches.filter((match) => match.kind === 'name' || match.kind === 'alias')
          : [...matches];
      const seen = new Set(ranked.map((match) => match.id));
      for (const match of found.results) {
        if (!seen.has(match.id)) {
          ranked.push(textById.get(match.id) ?? { ...match, kind: 'semantic' });
          seen.add(match.id);
        }
      }
      ranked.push(...matches.filter((match) => !seen.has(match.id)));
      matches.splice(0, matches.length, ...ranked.slice(0, input.limit));
    } catch (error) {
      if (!(error instanceof AiError || error instanceof EmbeddingCollectionError)) {
        throw error;
      }
      semantic = 'unavailable';
      notice =
        'Related-food search is unavailable. Showing name, alias, brand and description matches.';
    }
  }
  return { matches, textTotal: text.total, semantic, notice };
}
