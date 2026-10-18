jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    nutrition: {
      autofillRecipe: { useMutation: jest.fn() },
      createProduct: { useMutation: jest.fn() },
      updateProduct: { useMutation: jest.fn() },
      getProduct: { useQuery: jest.fn() },
    },
  },
}));
jest.mock('./ProductPicker', () => ({
  ProductPicker: ({ onChange }: { onChange: (value: unknown) => void }) => (
    <button
      type="button"
      onClick={() => onChange(require('@/lib/nutrition/test-fixtures').productFixture)}
    >
      Choose fixture ingredient
    </button>
  ),
}));
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { ProductEditor } from './ProductEditor';

const create = { mutateAsync: jest.fn(), isPending: false, error: null };
const update = { mutateAsync: jest.fn(), isPending: false, error: null };
beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = jest.fn();
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.releasePointerCapture = jest.fn();
});
beforeEach(() => {
  jest.clearAllMocks();
  create.mutateAsync.mockResolvedValue({ id: 'created' });
  (trpc.nutrition.autofillRecipe.useMutation as jest.Mock).mockReturnValue({
    mutateAsync: jest.fn(),
    isPending: false,
    error: null,
  });
  (trpc.nutrition.createProduct.useMutation as jest.Mock).mockReturnValue(create);
  (trpc.nutrition.updateProduct.useMutation as jest.Mock).mockReturnValue(update);
  (trpc.nutrition.getProduct.useQuery as jest.Mock).mockReturnValue({
    data: undefined,
    error: null,
  });
});

it('saves a calculated recipe with a selected ingredient and explicit prepared yield', async () => {
  const user = userEvent.setup();
  render(<ProductEditor product={null} onClose={jest.fn()} onSaved={jest.fn()} />);
  await user.type(screen.getByRole('textbox', { name: 'Product name' }), 'Fixture recipe');
  await user.click(screen.getByRole('combobox', { name: 'Nutrition calculation' }));
  await user.click(screen.getByRole('option', { name: 'Calculate from recipe ingredients' }));
  await user.click(screen.getByRole('combobox', { name: 'Reference unit' }));
  await user.click(screen.getByRole('option', { name: 'Named serving' }));
  await user.type(screen.getByRole('textbox', { name: 'Nutrition serving name' }), 'portion');
  await user.click(screen.getByRole('button', { name: 'Add ingredient' }));
  await user.click(screen.getByRole('button', { name: 'Choose fixture ingredient' }));
  await user.type(screen.getByRole('textbox', { name: 'Prepared recipe yield' }), '4');
  await user.click(screen.getByRole('button', { name: 'Save product' }));
  await waitFor(() => expect(create.mutateAsync).toHaveBeenCalled());
  expect(create.mutateAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      calculationMode: 'CALCULATED',
      yieldQuantity: '4',
      yieldUnit: 'SERVING',
      referenceQuantity: '1',
      components: [
        expect.objectContaining({
          quantity: '1',
          unit: 'SERVING',
          servingId: '00000000-0000-4000-8000-000000000002',
        }),
      ],
    })
  );
  expect(screen.queryByLabelText('Calories (kcal)')).not.toBeInTheDocument();
});

it('opens the recipe shortcut with ingredients and portion settings immediately visible', () => {
  render(
    <ProductEditor
      product={null}
      initialCalculationMode="CALCULATED"
      onClose={jest.fn()}
      onSaved={jest.fn()}
    />
  );
  expect(screen.getByRole('heading', { name: 'Create recipe' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add ingredient' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Reference quantity' })).toHaveValue('1');
  expect(screen.getByRole('textbox', { name: 'Nutrition serving name' })).toHaveValue('portion');
  expect(screen.getByRole('textbox', { name: 'Prepared recipe yield' })).toHaveValue('');
  expect(screen.queryByRole('textbox', { name: 'Calories (kcal)' })).not.toBeInTheDocument();
});

it('saves decimal label values and a fractional household serving without client arithmetic', async () => {
  const user = userEvent.setup();
  const onSaved = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  const parentSubmit = jest.fn();
  render(
    <form onSubmit={parentSubmit}>
      <ProductEditor product={null} onClose={onClose} onSaved={onSaved} />
    </form>
  );
  await user.type(screen.getByRole('textbox', { name: 'Product name' }), 'Peanut butter');
  await user.type(screen.getByRole('textbox', { name: 'Calories (kcal)' }), '588.5');
  await user.type(screen.getByRole('textbox', { name: 'Protein (g)' }), '25');
  await user.type(screen.getByRole('textbox', { name: 'Carbohydrates (g)' }), '20');
  await user.type(screen.getByRole('textbox', { name: 'Fat (g)' }), '50');
  await user.click(screen.getByRole('button', { name: 'Add serving' }));
  await user.type(screen.getByLabelText('Serving name'), 'teaspoon');
  await user.type(screen.getByLabelText('One equals'), '4.5');
  await user.click(screen.getByLabelText('Estimated conversion'));
  await user.click(screen.getByRole('button', { name: 'Save product' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(create.mutateAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Peanut butter',
      calories: '588.5',
      fiber: null,
      referenceQuantity: '100',
      referenceUnit: 'G',
      servings: [
        expect.objectContaining({
          name: 'teaspoon',
          quantity: '4.5',
          canonicalUnit: 'G',
          isDefault: true,
          isEstimated: true,
        }),
      ],
    })
  );
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(parentSubmit).not.toHaveBeenCalled();
});

it('preserves invalid inputs and explains decimal validation before sending a mutation', async () => {
  const user = userEvent.setup();
  render(<ProductEditor product={null} onClose={jest.fn()} onSaved={jest.fn()} />);
  await user.type(screen.getByRole('textbox', { name: 'Product name' }), 'Milk');
  for (const label of ['Calories (kcal)', 'Protein (g)', 'Carbohydrates (g)', 'Fat (g)']) {
    await user.type(
      screen.getByRole('textbox', { name: label }),
      label === 'Calories (kcal)' ? '-1' : '0'
    );
  }
  await user.click(screen.getByRole('button', { name: 'Save product' }));
  expect(await screen.findByText('Check product details')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Calories (kcal)' })).toHaveValue('-1');
  expect(create.mutateAsync).not.toHaveBeenCalled();
});

it('fills editable recipe metadata without saving or changing ingredient amounts', async () => {
  const user = userEvent.setup();
  const mutateAsync = jest.fn().mockResolvedValue({
    name: 'Nut bowl',
    aliases: ['PB bowl'],
    description: 'A peanut butter bowl.',
  });
  (trpc.nutrition.autofillRecipe.useMutation as jest.Mock).mockReturnValue({
    mutateAsync,
    isPending: false,
    error: null,
  });
  const components = [
    { childProductId: '00000000-0000-4000-8000-000000000001', quantity: '30', unit: 'G' as const },
  ];
  render(
    <ProductEditor
      product={null}
      initialCalculationMode="CALCULATED"
      initialComponents={components}
      onClose={jest.fn()}
      onSaved={jest.fn()}
    />
  );
  await user.click(screen.getByRole('button', { name: 'Autofill recipe details with AI' }));
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Product name' })).toHaveValue('Nut bowl')
  );
  expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ components }));
  expect(screen.getByRole('textbox', { name: 'Ingredient quantity' })).toHaveValue('30');
  expect(create.mutateAsync).not.toHaveBeenCalled();
  expect(await screen.findByRole('textbox', { name: 'Description' })).toHaveValue(
    'A peanut butter bowl.'
  );
});

it('preserves entered recipe details when autofill fails', async () => {
  const user = userEvent.setup();
  (trpc.nutrition.autofillRecipe.useMutation as jest.Mock).mockReturnValue({
    mutateAsync: jest.fn().mockRejectedValue(new Error('Offline')),
    isPending: false,
    error: { message: 'Offline' },
  });
  render(
    <ProductEditor
      product={null}
      initialCalculationMode="CALCULATED"
      initialComponents={[
        { childProductId: '00000000-0000-4000-8000-000000000001', quantity: '30', unit: 'G' },
      ]}
      onClose={jest.fn()}
      onSaved={jest.fn()}
    />
  );
  await user.type(screen.getByRole('textbox', { name: 'Product name' }), 'My bowl');
  await user.click(screen.getByRole('button', { name: 'Autofill recipe details with AI' }));
  expect(screen.getByRole('textbox', { name: 'Product name' })).toHaveValue('My bowl');
  expect(screen.getByText('Offline')).toBeInTheDocument();
  expect(create.mutateAsync).not.toHaveBeenCalled();
});
