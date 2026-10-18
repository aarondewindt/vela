import { createHash } from 'node:crypto';
import { normalizeProductText } from './normalization';

export function productEmbeddingText(product: {
  name: string;
  brand: string | null;
  description: string | null;
  aliases: string[];
}) {
  return [
    `Food: ${normalizeProductText(product.name)}`,
    product.brand && `Brand: ${normalizeProductText(product.brand)}`,
    product.description && `Description: ${normalizeProductText(product.description)}`,
    product.aliases.length &&
      `Aliases: ${[...new Set(product.aliases.map(normalizeProductText))].sort().join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function productEmbeddingDocument(
  product: Parameters<typeof productEmbeddingText>[0] & {
    id: string;
    searchUpdatedAt: Date;
  }
) {
  const text = productEmbeddingText(product);
  return {
    id: product.id,
    text,
    sourceHash: createHash('sha256').update(text).digest('hex'),
    updatedAt: product.searchUpdatedAt,
  };
}
