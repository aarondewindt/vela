/** @jest-environment node */
import { productInputSchema, type ProductInput } from './schema';
import { normalizeProductText, productSearchFields } from './normalization';

export const productInput: ProductInput = {
  name: 'Peanut butter',
  brand: null,
  description: null,
  aliases: ['PB', 'Pindakaas'],
  calculationMode: 'DIRECT',
  referenceQuantity: '100',
  referenceUnit: 'G',
  referenceLabel: null,
  calories: '588',
  protein: '25',
  carbohydrates: '20',
  fat: '50',
  fiber: null,
  servingSizeQuantity: null,
  servingSizeUnit: null,
  servingSizeIsEstimated: false,
  densityGramsPerMl: null,
  densityIsEstimated: false,
  verificationStatus: 'UNVERIFIED',
  servings: [
    {
      name: 'tablespoon',
      aliases: ['tbsp'],
      quantity: '15',
      canonicalUnit: 'G',
      isDefault: true,
      isEstimated: true,
    },
  ],
};

it('requires direct nutrients and decimal strings while stripping forged provenance', () => {
  expect(
    productInputSchema.parse({ ...productInput, sourceType: 'DATASET', userId: 'foreign' })
  ).not.toHaveProperty('sourceType');
  expect(productInputSchema.safeParse({ ...productInput, calories: 588 }).success).toBe(false);
  expect(productInputSchema.safeParse({ ...productInput, protein: '-1' }).success).toBe(false);
  expect(
    productInputSchema.safeParse({ ...productInput, calculationMode: 'CALCULATED' }).success
  ).toBe(false);
});
it('rejects ambiguous serving references and incomplete conversions', () => {
  expect(productInputSchema.safeParse({ ...productInput, referenceUnit: 'SERVING' }).success).toBe(
    false
  );
  expect(productInputSchema.safeParse({ ...productInput, servingSizeQuantity: '60' }).success).toBe(
    false
  );
  expect(productInputSchema.safeParse({ ...productInput, densityIsEstimated: true }).success).toBe(
    false
  );
  expect(
    productInputSchema.safeParse({
      ...productInput,
      servings: [{ ...productInput.servings[0], canonicalUnit: 'SERVING' }],
    }).success
  ).toBe(false);
});
it('rejects duplicate names, stable IDs and multiple defaults', () => {
  const serving = productInput.servings[0];
  expect(
    productInputSchema.safeParse({
      ...productInput,
      servings: [serving, { ...serving, name: ' TABLESPOON ' }],
    }).success
  ).toBe(false);
  expect(
    productInputSchema.safeParse({
      ...productInput,
      servings: [serving, { ...serving, name: 'teaspoon' }],
    }).success
  ).toBe(false);
  const id = '00000000-0000-4000-8000-000000000001';
  expect(
    productInputSchema.safeParse({
      ...productInput,
      servings: [
        { ...serving, id },
        { ...serving, id, name: 'tsp', isDefault: false },
      ],
    }).success
  ).toBe(false);
});
it('normalizes Unicode, whitespace and aliases consistently for search', () => {
  expect(normalizeProductText('  ＰＥＡＮＵＴ\t Butter  ')).toBe('peanut butter');
  expect(productSearchFields(productInput)).toEqual({
    normalizedName: 'peanut butter',
    normalizedAliases: ['pb', 'pindakaas'],
    searchText: 'peanut butter\npb\npindakaas',
  });
});
it('allows full-length food aliases while keeping household aliases bounded', () => {
  expect(
    productInputSchema.safeParse({ ...productInput, aliases: ['A'.repeat(103)] }).success
  ).toBe(true);
  expect(
    productInputSchema.safeParse({ ...productInput, aliases: ['A'.repeat(241)] }).success
  ).toBe(false);
  expect(
    productInputSchema.safeParse({
      ...productInput,
      servings: [{ ...productInput.servings[0], aliases: ['A'.repeat(81)] }],
    }).success
  ).toBe(false);
});
