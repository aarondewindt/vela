jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    nutrition: {
      createProduct: { useMutation: jest.fn() },
      updateProduct: { useMutation: jest.fn() },
    },
  },
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
  (trpc.nutrition.createProduct.useMutation as jest.Mock).mockReturnValue(create);
  (trpc.nutrition.updateProduct.useMutation as jest.Mock).mockReturnValue(update);
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
