/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('./products', () => ({ nutritionProducts: { search: jest.fn() } }));
import { nutritionProducts } from './products';
import { productFixture } from './test-fixtures';
import { newDraftItem } from './draft-items';
import { matchDraftItem } from './draft-matching';
beforeEach(() => jest.resetAllMocks());
it('automatically selects only a unique exact name or alias, without model calls for exact matches', async () => {
  (nutritionProducts.search as jest.Mock).mockResolvedValue({
    matches: [{ kind: 'alias', product: productFixture }],
  });
  const result = await matchDraftItem('owner', {
    ...newDraftItem('PB'),
    quantity: '2',
    unit: 'tablespoon',
  });
  expect(result.snapshot?.productId).toBe(productFixture.id);
  expect(result.input?.servingId).toBe(productFixture.servings[0].id);
  expect(nutritionProducts.search).toHaveBeenCalledTimes(1);
  expect(nutritionProducts.search).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({ semantic: false })
  );
});
it('keeps multiple exact choices unresolved', async () => {
  (nutritionProducts.search as jest.Mock).mockResolvedValue({
    matches: [
      { kind: 'name', product: productFixture },
      {
        kind: 'name',
        product: { ...productFixture, id: '00000000-0000-4000-8000-000000000099', brand: 'Other' },
      },
    ],
  });
  const result = await matchDraftItem('owner', newDraftItem('Peanut butter'));
  expect(result.snapshot).toBeNull();
  expect(result.candidates).toHaveLength(2);
});
it('offers text/semantic alternatives without silently choosing one', async () => {
  (nutritionProducts.search as jest.Mock).mockResolvedValue({
    matches: [{ kind: 'semantic', product: productFixture }],
  });
  const result = await matchDraftItem('owner', newDraftItem('nut spread'));
  expect(nutritionProducts.search).toHaveBeenLastCalledWith(
    'owner',
    expect.objectContaining({ semantic: true, ranking: 'related-first', limit: 5 }),
    undefined
  );
  expect(result.snapshot).toBeNull();
  expect(result.candidates[0].name).toBe('Peanut butter');
});
it('retains a visible search fallback notice without selecting a partial match', async () => {
  (nutritionProducts.search as jest.Mock)
    .mockResolvedValueOnce({ matches: [{ kind: 'text', product: productFixture }] })
    .mockResolvedValueOnce({
      matches: [{ kind: 'text', product: productFixture }],
      notice:
        'Related-food search is unavailable. Showing name, alias, brand and description matches.',
    });
  const controller = new AbortController();
  const result = await matchDraftItem('owner', newDraftItem('spread'), controller.signal);
  expect(result.snapshot).toBeNull();
  expect(result.searchNotice).toContain('Related-food search is unavailable');
  expect(nutritionProducts.search).toHaveBeenLastCalledWith(
    'owner',
    expect.objectContaining({ ranking: 'related-first' }),
    controller.signal
  );
});
