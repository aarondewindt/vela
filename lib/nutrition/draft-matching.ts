import 'server-only';
import { nutritionProducts } from './products';
import { withDraftProduct } from './draft-items';
import type { DraftItem } from './draft-schema';

export async function matchDraftItem(
  userId: string,
  item: DraftItem,
  signal?: AbortSignal
): Promise<DraftItem> {
  // A single exact name/alias is deterministic; partial and semantic matches require selection.
  let found = await nutritionProducts.search(userId, {
    query: item.query,
    semantic: false,
    limit: 5,
  });
  if (!found.matches.some((match) => match.kind === 'name' || match.kind === 'alias')) {
    found = await nutritionProducts.search(
      userId,
      { query: item.query, semantic: true, ranking: 'related-first', limit: 5 },
      signal
    );
  }
  const exact = found.matches.filter((match) => match.kind === 'name' || match.kind === 'alias');
  const matched = withDraftProduct(item, exact.length === 1 ? exact[0].product : null);
  return {
    ...matched,
    searchNotice: found.notice ?? null,
    candidates: found.matches.map(({ product }) => ({
      id: product.id,
      name: product.name,
      brand: product.brand,
    })),
  };
}
