import type { ReferenceSnapshot } from './diary-schema';
import type { NutritionProduct } from './products';

export function snapshotSources(snapshot: ReferenceSnapshot) {
  return [
    snapshot.source,
    ...('composition' in snapshot
      ? snapshot.composition.flatMap((node) => (node.source ? [node.source] : []))
      : []),
  ];
}

export function productSources(product: NutritionProduct) {
  return [
    { name: product.sourceName, version: product.sourceVersion },
    ...(product.composition?.flatMap((node) => (node.source ? [node.source] : [])) ?? []),
  ];
}
