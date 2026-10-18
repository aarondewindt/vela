import { productEmbeddingDocument, productEmbeddingText } from './product-embedding-text';

const product = {
  id: 'food',
  name: '  Peanut BUTTER ',
  brand: 'A brand',
  description: 'Roasted nuts',
  aliases: ['PB', 'Nut spread'],
  searchUpdatedAt: new Date('2026-10-18T00:00:00Z'),
};
it('embeds only stable food text and excludes nutrition, conversion and provenance numbers', () => {
  const value = {
    ...product,
    calories: '588',
    referenceQuantity: '100',
    sourceName: 'private import',
    servings: [{ name: 'spoon' }],
  };
  expect(productEmbeddingText(value)).toBe(
    'Food: peanut butter\nBrand: a brand\nDescription: roasted nuts\nAliases: nut spread, pb'
  );
  expect(productEmbeddingDocument(value)).toEqual(
    expect.objectContaining({
      id: 'food',
      updatedAt: product.searchUpdatedAt,
      sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  );
});
it('ignores case, whitespace, alias ordering and duplicate aliases but detects meaningful changes', () => {
  const original = productEmbeddingDocument(product);
  expect(
    productEmbeddingDocument({
      ...product,
      name: 'peanut butter',
      aliases: ['nut spread', 'pb', 'PB'],
    }).sourceHash
  ).toBe(original.sourceHash);
  for (const change of [
    { name: 'Almond butter' },
    { brand: 'Other' },
    { description: 'Raw' },
    { aliases: ['peanuts'] },
  ]) {
    expect(productEmbeddingDocument({ ...product, ...change }).sourceHash).not.toBe(
      original.sourceHash
    );
  }
});
