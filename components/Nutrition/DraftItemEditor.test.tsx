jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: jest.fn(),
    nutrition: {
      getProduct: { useQuery: jest.fn() },
      calculateProduct: { useQuery: jest.fn() },
      editDraft: { useMutation: jest.fn() },
      createProduct: { useMutation: jest.fn() },
      updateProduct: { useMutation: jest.fn() },
      autofillRecipe: { useMutation: jest.fn() },
    },
  },
}));
jest.mock('@mantine/hooks', () => ({
  ...jest.requireActual('@mantine/hooks'),
  useDebouncedValue: (value: unknown) => [value],
}));
jest.mock('./ProductPicker', () => ({
  ProductPicker: ({ onChange }: { onChange: (product: unknown) => void }) => (
    <button type="button" onClick={() => onChange(productFixture)}>
      Choose fixture product
    </button>
  ),
}));
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { entryFixture, productFixture } from '@/lib/nutrition/test-fixtures';
import type { MealDraft } from '@/lib/nutrition/drafts';
import { DraftItemEditor } from './DraftItemEditor';

const item: MealDraft['items'][number] = {
  id: entryFixture.id,
  query: 'PB',
  quantity: '30',
  unit: 'g',
  snapshot: entryFixture.snapshot,
  input: { quantity: '30', unit: 'G' },
  candidates: [],
  issue: null,
  calculation: null,
};
const draft = { id: '00000000-0000-4000-8000-000000000099', revision: 4 } as MealDraft;
const edit = { mutateAsync: jest.fn(), isPending: false, error: null };
const update = { mutateAsync: jest.fn(), isPending: false, error: null };
const utils = {
  nutrition: {
    getProduct: { setData: jest.fn(), invalidate: jest.fn() },
    listProducts: { invalidate: jest.fn() },
    searchProducts: { invalidate: jest.fn() },
    productSuggestions: { invalidate: jest.fn() },
    calculateProduct: { invalidate: jest.fn() },
  },
};
const props = { draft, item, onClose: jest.fn(), onSaved: jest.fn() };
beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = jest.fn();
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.releasePointerCapture = jest.fn();
});
beforeEach(() => {
  jest.clearAllMocks();
  (trpc.useUtils as jest.Mock).mockReturnValue(utils);
  (trpc.nutrition.getProduct.useQuery as jest.Mock).mockReturnValue({
    data: productFixture,
    isFetchedAfterMount: true,
    error: null,
    isFetching: false,
  });
  (trpc.nutrition.calculateProduct.useQuery as jest.Mock).mockReturnValue({});
  (trpc.nutrition.editDraft.useMutation as jest.Mock).mockReturnValue(edit);
  (trpc.nutrition.updateProduct.useMutation as jest.Mock).mockReturnValue(update);
  for (const mutation of ['createProduct', 'autofillRecipe'] as const) {
    (trpc.nutrition[mutation].useMutation as jest.Mock).mockReturnValue({
      isPending: false,
      error: null,
    });
  }
  edit.mutateAsync.mockResolvedValue(draft);
});

it('edits the selected catalog product inline and uses its new serving without losing the draft quantity', async () => {
  const user = userEvent.setup();
  const serving = { ...productFixture.servings[0], name: 'teaspoon', quantity: '5' };
  const saved = { ...productFixture, version: 2, densityGramsPerMl: '1.2', servings: [serving] };
  update.mutateAsync.mockResolvedValue(saved);
  (trpc.nutrition.getProduct.useQuery as jest.Mock).mockReturnValue({
    data: { ...productFixture, servings: [] },
    isFetchedAfterMount: true,
    error: null,
  });
  render(<DraftItemEditor {...props} />);
  await user.clear(screen.getByRole('textbox', { name: 'Quantity' }));
  await user.type(screen.getByRole('textbox', { name: 'Quantity' }), '2.5');
  await user.click(screen.getByRole('button', { name: 'Edit selected product' }));
  expect(screen.getByRole('textbox', { name: 'Product name' })).toHaveValue(productFixture.name);
  await user.click(screen.getByRole('button', { name: 'Add serving' }));
  await user.type(screen.getByLabelText('Serving name'), 'teaspoon');
  await user.type(screen.getByLabelText('One equals'), '5');
  await user.click(screen.getByRole('button', { name: 'Physical conversions (optional)' }));
  await user.type(screen.getByLabelText('Density (g per ml)'), '1.2');
  await user.click(screen.getByRole('button', { name: 'Save product' }));
  await waitFor(() => expect(screen.queryByText('Edit food product')).not.toBeInTheDocument());
  expect(update.mutateAsync).toHaveBeenCalledWith({
    id: productFixture.id,
    version: 1,
    product: expect.objectContaining({
      densityGramsPerMl: '1.2',
      servings: [expect.objectContaining({ name: 'teaspoon', quantity: '5' })],
    }),
  });
  expect(edit.mutateAsync).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Quantity' })).toHaveValue('2.5');
  expect(utils.nutrition.getProduct.setData).toHaveBeenCalledWith({ id: saved.id }, saved);
  expect(utils.nutrition.calculateProduct.invalidate).toHaveBeenCalled();
  expect(utils.nutrition.searchProducts.invalidate).toHaveBeenCalled();
  await user.click(screen.getByRole('combobox', { name: 'Unit' }));
  await user.click(screen.getByRole('option', { name: 'teaspoon (estimated)' }));
  await user.click(screen.getByRole('button', { name: 'Save draft food' }));
  expect(edit.mutateAsync).toHaveBeenCalledWith({
    id: draft.id,
    revision: draft.revision,
    change: {
      type: 'item',
      itemId: item.id,
      productId: saved.id,
      quantity: '2.5',
      unit: `serving:${serving.id}`,
    },
  });
});

it('preserves unsaved draft input when cancelling the product editor', async () => {
  const user = userEvent.setup();
  render(<DraftItemEditor {...props} />);
  await user.click(screen.getByRole('button', { name: 'Edit selected product' }));
  await user.clear(screen.getByRole('textbox', { name: 'Product name' }));
  await user.type(screen.getByRole('textbox', { name: 'Product name' }), 'Unsaved name');
  await user.click(screen.getByRole('button', { name: 'Close product editor' }));
  expect(screen.getByRole('textbox', { name: 'Quantity' })).toHaveValue('30');
  expect(screen.getByRole('combobox', { name: 'Unit' })).toHaveValue('g');
  expect(update.mutateAsync).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
});

it('requires a product selection and edits a newly chosen product', async () => {
  const user = userEvent.setup();
  (trpc.nutrition.getProduct.useQuery as jest.Mock).mockReturnValue({});
  render(<DraftItemEditor {...props} item={{ ...item, snapshot: null, input: null }} />);
  expect(screen.getByRole('button', { name: 'Edit selected product' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Choose fixture product' }));
  await user.click(screen.getByRole('button', { name: 'Edit selected product' }));
  expect(screen.getByRole('textbox', { name: 'Product name' })).toHaveValue(productFixture.name);
});

it('replaces a removed serving selection with the product reference unit', async () => {
  const user = userEvent.setup();
  update.mutateAsync.mockResolvedValue({ ...productFixture, version: 2, servings: [] });
  render(
    <DraftItemEditor
      {...props}
      item={{
        ...item,
        input: {
          quantity: '30',
          unit: 'SERVING',
          servingId: productFixture.servings[0].id,
        },
      }}
    />
  );
  await user.click(screen.getByRole('button', { name: 'Edit selected product' }));
  await user.click(screen.getByRole('button', { name: 'Remove serving' }));
  await user.click(screen.getByRole('button', { name: 'Save product' }));
  await waitFor(() => expect(screen.queryByText('Edit food product')).not.toBeInTheDocument());
  expect(screen.getByRole('combobox', { name: 'Unit' })).toHaveValue('g');
  expect(screen.getByRole('textbox', { name: 'Quantity' })).toHaveValue('30');
});

it('keeps product edits open and preserves draft input when saving the product fails', async () => {
  const user = userEvent.setup();
  update.mutateAsync.mockRejectedValue(new Error('Could not save'));
  (trpc.nutrition.updateProduct.useMutation as jest.Mock).mockReturnValue({
    ...update,
    error: { message: 'Could not save' },
  });
  render(<DraftItemEditor {...props} />);
  await user.click(screen.getByRole('button', { name: 'Edit selected product' }));
  await user.clear(screen.getByRole('textbox', { name: 'Product name' }));
  await user.type(screen.getByRole('textbox', { name: 'Product name' }), 'Updated name');
  await user.click(screen.getByRole('button', { name: 'Save product' }));
  await waitFor(() => expect(update.mutateAsync).toHaveBeenCalled());
  expect(screen.getByRole('textbox', { name: 'Product name' })).toHaveValue('Updated name');
  expect(screen.getByText('Could not save')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Quantity' })).toHaveValue('30');
  expect(utils.nutrition.getProduct.setData).not.toHaveBeenCalled();
  expect(edit.mutateAsync).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
});
