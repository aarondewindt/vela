/** @jest-environment node */
import { productInputSchema } from '../schema';
import { productFixture } from '../test-fixtures';
import { normalizeExtraction } from './normalize';
import { dutchMilk, missing } from './fixtures';
import { rowConflicts, suggestionRows } from './review';

it('reviews nutrition with its basis and clears unknown nutrients on a basis change', () => {
  const current = productInputSchema.parse({ ...productFixture, referenceUnit: 'G', fiber: '9' });
  const suggestion = normalizeExtraction(dutchMilk());
  const row = suggestionRows(suggestion, current).find((item) => item.id === 'nutrition')!;
  expect(row.patch).toMatchObject({
    referenceQuantity: '100',
    referenceUnit: 'ML',
    calories: '47',
    fiber: null,
  });
  expect(rowConflicts(row, new Set(['protein']))).toBe(true);
  expect(rowConflicts(row, new Set(['brand']))).toBe(false);
  expect(current.fiber).toBe('9');
});
it('preserves unknown nutrients when keeping the same basis', () => {
  const current = productInputSchema.parse({
    ...productFixture,
    referenceUnit: 'ML',
    referenceQuantity: '100',
    fiber: '9',
  });
  const row = suggestionRows(normalizeExtraction(dutchMilk()), current).find(
    (item) => item.id === 'nutrition'
  )!;
  expect(row.patch).not.toHaveProperty('fiber');
});
it('does not apply nutrients with unknown reference and preserves unrelated servings', () => {
  const current = productInputSchema.parse({
    ...productFixture,
    servings: [
      {
        name: 'cup',
        aliases: [],
        quantity: '250',
        canonicalUnit: 'ML',
        isDefault: false,
        isEstimated: false,
      },
    ],
  });
  const evidence = dutchMilk();
  evidence.tables[0].unit = null;
  evidence.tables[0].servingQuantity = missing;
  const rows = suggestionRows(normalizeExtraction(evidence), current);
  expect(rows.find((row) => row.id === 'nutrition')).toBeUndefined();
  expect(rows.find((row) => row.id === 'servings')?.patch.servings?.map((s) => s.name)).toEqual([
    'cup',
    'package',
  ]);
});
it('keeps the ordinary product validator authoritative for missing values', () => {
  const current = productInputSchema.parse(productFixture);
  const evidence = dutchMilk();
  evidence.tables[0].values = [];
  const patch = suggestionRows(normalizeExtraction(evidence), {
    ...current,
    referenceUnit: 'G',
  }).find((row) => row.id === 'nutrition')!.patch;
  expect(productInputSchema.safeParse({ ...current, ...patch }).success).toBe(false);
});
