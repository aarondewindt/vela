/** @jest-environment node */
import { productFixture } from './test-fixtures';
import { captureNutritionSnapshot } from './snapshots';
import {
  applyDraftInterpretation,
  newDraftItem,
  previewDraftItems,
  resolveDraftQuantity,
  withDraftProduct,
} from './draft-items';
import { draftInterpretationSchema } from './draft-schema';
const snapshot = captureNutritionSnapshot(productFixture);
const base = () =>
  withDraftProduct({ ...newDraftItem('PB'), quantity: '2', unit: 'tablespoons' }, productFixture);
const current = () => ({ items: [base()], date: '2026-10-18', mealCategory: 'LUNCH' as const });
it('resolves standard units and configured household aliases/plurals without inventing conversions', () => {
  expect(resolveDraftQuantity(snapshot, '0.5', 'kilograms')).toEqual({
    quantity: '0.5',
    unit: 'KG',
  });
  expect(resolveDraftQuantity(snapshot, '2', 'tablespoons')).toEqual({
    quantity: '2',
    unit: 'SERVING',
    servingId: productFixture.servings[0].id,
  });
  expect(resolveDraftQuantity(snapshot, '2', 'tbsp')?.servingId).toBe(
    productFixture.servings[0].id
  );
  expect(resolveDraftQuantity(snapshot, '2', 'cups')).toBeNull();
  expect(resolveDraftQuantity(snapshot, null, 'g')).toBeNull();
});
it('keeps missing, unsupported and incompatible quantities unresolved and totals only valid foods', () => {
  const first = base();
  const missing = newDraftItem('banana');
  const incompatible = withDraftProduct(
    { ...newDraftItem('PB'), quantity: '2', unit: 'ml' },
    productFixture
  );
  const preview = previewDraftItems([first, missing, incompatible]);
  expect(preview.unresolved).toBe(2);
  expect(preview.totals.calories).toBe('176.4');
  expect(preview.items[0].calculation?.estimated).toBe(true);
  expect(preview.items[2].issue).toContain('density');
});
it('applies stable-ID corrections, additions, removals and date/meal changes to a copy', async () => {
  const original = current();
  const match = jest.fn(async (item) => item);
  const result = await applyDraftInterpretation(
    original,
    {
      reply: 'Updated.',
      questions: [],
      operations: [
        { type: 'setQuantity', itemId: original.items[0].id, quantity: '3', unit: 'tablespoon' },
        { type: 'addItem', productQuery: 'banana', quantity: '1', unit: 'piece' },
        { type: 'changeMealCategory', mealCategory: 'BREAKFAST' },
        { type: 'changeDate', date: '2026-10-17' },
      ],
    },
    match
  );
  expect(result.items[0].id).toBe(original.items[0].id);
  expect(result.items[0].quantity).toBe('3');
  expect(original.items[0].quantity).toBe('2');
  expect(result.items[1].id).not.toBe(original.items[0].id);
  expect(result).toMatchObject({ date: '2026-10-17', mealCategory: 'BREAKFAST' });
  const removed = await applyDraftInterpretation(
    result,
    {
      reply: 'Removed.',
      questions: [],
      operations: [{ type: 'removeItem', itemId: result.items[1].id }],
    },
    match
  );
  expect(removed.items).toHaveLength(1);
});
it('rejects unknown IDs and malformed operation batches without changing the original', async () => {
  const original = current();
  await expect(
    applyDraftInterpretation(
      original,
      {
        reply: 'Update.',
        questions: [],
        operations: [
          { type: 'setQuantity', itemId: original.items[0].id, quantity: '4', unit: 'g' },
          { type: 'removeItem', itemId: '00000000-0000-4000-8000-000000000099' },
        ],
      },
      async (item) => item
    )
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(original.items[0].quantity).toBe('2');
  expect(
    draftInterpretationSchema.safeParse({
      reply: 'Bad.',
      questions: [],
      operations: [{ type: 'addItem', productQuery: 'rice', quantity: 200, unit: 'g' }],
    }).success
  ).toBe(false);
  expect(
    draftInterpretationSchema.safeParse({
      reply: 'Bad.',
      questions: [],
      operations: [{ type: 'executeSql', sql: 'DELETE' }],
    }).success
  ).toBe(false);
});
it('flags ambiguous dates for review and leaves missing amounts unresolved', async () => {
  const result = await applyDraftInterpretation(
    current(),
    {
      reply: 'Check date.',
      questions: [],
      operations: [
        { type: 'changeDate', date: null },
        { type: 'addItem', productQuery: 'broccoli', quantity: null, unit: null },
      ],
    },
    async (item) => item
  );
  expect(result.date).toBe('2026-10-18');
  expect(result.questions).toContain('Check the target date before confirming this meal.');
  expect(result.items[1]).toMatchObject({ quantity: null, unit: null, input: null });
});
