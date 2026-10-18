/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/ai', () => ({ generateStructured: jest.fn() }));
jest.mock('@/lib/model-settings/service', () => ({ requireModelSelection: jest.fn() }));
jest.mock('./products', () => ({ nutritionProducts: { get: jest.fn() } }));
import { generateStructured } from '@/lib/ai';
import { requireModelSelection } from '@/lib/model-settings/service';
import { nutritionProducts } from './products';
import { productFixture } from './test-fixtures';
import { autofillRecipe } from './recipe-autofill';
import { recipeAutofillResultSchema } from './recipe-autofill-schema';

const input = {
  name: '',
  aliases: [],
  description: null,
  components: [
    {
      childProductId: productFixture.id,
      quantity: '2',
      unit: 'SERVING',
      servingId: productFixture.servings[0].id,
    },
  ],
  yieldQuantity: null,
  yieldUnit: null,
};
beforeEach(() => {
  jest.resetAllMocks();
  (requireModelSelection as jest.Mock).mockResolvedValue({ provider: 'ollama', modelId: 'chat' });
  (nutritionProducts.get as jest.Mock).mockResolvedValue(productFixture);
});
it('sends owner-scoped selected ingredient names and quantities with existing metadata', async () => {
  await autofillRecipe('owner', input);
  expect(nutritionProducts.get).toHaveBeenCalledWith('owner', productFixture.id);
  expect(requireModelSelection).toHaveBeenCalledWith('owner', 'nutrition.recipeAutofill');
  const args = (generateStructured as jest.Mock).mock.calls[0][0];
  expect(JSON.parse(args.prompt)).toMatchObject({
    ingredients: [{ name: 'Peanut butter', quantity: '2', unit: 'tablespoon' }],
  });
  expect(args.schema).toBe(recipeAutofillResultSchema);
});
it('does not call the model when an ingredient is unavailable to the owner', async () => {
  (nutritionProducts.get as jest.Mock).mockRejectedValue(new Error('Product not found'));
  await expect(autofillRecipe('owner', input)).rejects.toThrow('Product not found');
  expect(generateStructured).not.toHaveBeenCalled();
});
it('rejects empty selections and invalid quantities before model resolution', async () => {
  await expect(autofillRecipe('owner', { ...input, components: [] })).rejects.toThrow();
  await expect(
    autofillRecipe('owner', { ...input, components: [{ ...input.components[0], quantity: '-1' }] })
  ).rejects.toThrow();
  expect(requireModelSelection).not.toHaveBeenCalled();
});
