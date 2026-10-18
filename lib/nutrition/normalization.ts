export function normalizeProductText(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

export function productSearchFields(product: {
  name: string;
  aliases: string[];
  brand: string | null;
  description: string | null;
}) {
  return {
    normalizedName: normalizeProductText(product.name),
    normalizedAliases: [...new Set(product.aliases.map(normalizeProductText))],
    searchText: [product.name, ...product.aliases, product.brand, product.description]
      .filter(Boolean)
      .map((value) => normalizeProductText(value!))
      .join('\n'),
  };
}
