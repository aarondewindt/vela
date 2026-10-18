/** @jest-environment node */
import {
  calculateSnapshotNutrition,
  captureNutritionSnapshot,
  readNutritionSnapshot,
} from './snapshots';
import { productFixture } from './test-fixtures';

it('keeps original nutrition and household conversions after source edits or removal', () => {
  const product = structuredClone(productFixture);
  const snapshot = captureNutritionSnapshot(product);
  product.calories = '1000';
  product.servings[0].quantity = '30';
  product.servings = [];
  expect(
    calculateSnapshotNutrition(snapshot, {
      quantity: '2',
      unit: 'SERVING',
      servingId: productFixture.servings[0].id,
    })
  ).toMatchObject({
    unitLabel: 'tablespoon',
    estimated: true,
    nutrients: { calories: '176.4' },
  });
  expect(
    calculateSnapshotNutrition(snapshot, { quantity: '0.03', unit: 'KG' }).nutrients.calories
  ).toBe('176.4');
});
it('does not invent or fetch a conversion added after logging', () => {
  const snapshot = captureNutritionSnapshot(productFixture);
  expect(() =>
    calculateSnapshotNutrition(snapshot, {
      quantity: '1',
      unit: 'SERVING',
      servingId: '00000000-0000-4000-8000-000000000099',
    })
  ).toThrow('defined for this product');
  expect(() => calculateSnapshotNutrition(snapshot, { quantity: '1', unit: 'ML' })).toThrow(
    'density'
  );
});
it('rejects malformed or unsupported stored snapshots safely', () => {
  expect(() => readNutritionSnapshot({})).toThrow('saved nutrition reference');
  expect(() =>
    readNutritionSnapshot({ ...captureNutritionSnapshot(productFixture), schemaVersion: 2 })
  ).toThrow('saved nutrition reference');
});
