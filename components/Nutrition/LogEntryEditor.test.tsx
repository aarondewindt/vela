jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: jest.fn(),
    nutrition: {
      previewLogEntry: { useQuery: jest.fn() },
      calculateProduct: { useQuery: jest.fn() },
      createLogEntry: { useMutation: jest.fn() },
      updateLogEntry: { useMutation: jest.fn() },
    },
  },
}));
jest.mock('@mantine/hooks', () => ({
  ...jest.requireActual('@mantine/hooks'),
  useDebouncedValue: (value: unknown) => [value],
}));
jest.mock('./ProductPicker', () => ({
  ProductPicker: jest.fn(({ onChange }) => (
    <button type="button" onClick={() => onChange(productFixture)}>
      Choose fixture product
    </button>
  )),
}));
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { entryFixture, productFixture } from '@/lib/nutrition/test-fixtures';
import { LogEntryEditor } from './LogEntryEditor';
import { ProductPicker } from './ProductPicker';

const create = { mutateAsync: jest.fn(), reset: jest.fn(), isPending: false, error: null };
const update = { mutateAsync: jest.fn(), isPending: false, error: null };
beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = jest.fn();
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.releasePointerCapture = jest.fn();
});
beforeEach(() => {
  jest.clearAllMocks();
  create.mutateAsync.mockResolvedValue(entryFixture);
  update.mutateAsync.mockResolvedValue(entryFixture);
  (trpc.nutrition.createLogEntry.useMutation as jest.Mock).mockReturnValue(create);
  (trpc.nutrition.updateLogEntry.useMutation as jest.Mock).mockReturnValue(update);
  (trpc.nutrition.previewLogEntry.useQuery as jest.Mock).mockReturnValue({
    data: { nutrients: entryFixture.nutrients, estimated: false },
    isFetching: false,
    error: null,
  });
  (trpc.nutrition.calculateProduct.useQuery as jest.Mock).mockReturnValue({
    data: { nutrients: entryFixture.nutrients, estimated: true, productVersion: 1 },
    isFetching: false,
    error: null,
  });
});
it('edits a deleted product’s entry with captured units and no product lookup', async () => {
  const user = userEvent.setup();
  const onSaved = jest.fn().mockResolvedValue(undefined);
  render(
    <LogEntryEditor
      entry={{ ...entryFixture, productId: null }}
      date="2026-10-17"
      mealCategory="BREAKFAST"
      onClose={jest.fn()}
      onSaved={onSaved}
    />
  );
  await user.clear(screen.getByRole('textbox', { name: 'Quantity eaten' }));
  await user.type(screen.getByRole('textbox', { name: 'Quantity eaten' }), '60');
  await user.click(screen.getByRole('button', { name: 'Save food entry' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(update.mutateAsync).toHaveBeenCalledWith({
    id: entryFixture.id,
    version: 1,
    logDate: '2026-10-17',
    mealCategory: 'BREAKFAST',
    input: { quantity: '60', unit: 'G' },
  });
  expect(ProductPicker).not.toHaveBeenCalled();
  expect(trpc.nutrition.calculateProduct.useQuery).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ enabled: false })
  );
});
it('submits raw quantities with a stable request ID and a reviewed product version', async () => {
  const user = userEvent.setup();
  const onClose = jest.fn();
  render(
    <LogEntryEditor
      entry={null}
      date="2026-10-17"
      mealCategory="LUNCH"
      onClose={onClose}
      onSaved={jest.fn().mockResolvedValue(undefined)}
    />
  );
  await user.click(screen.getByRole('button', { name: 'Choose fixture product' }));
  await user.clear(screen.getByRole('textbox', { name: 'Quantity eaten' }));
  await user.type(screen.getByRole('textbox', { name: 'Quantity eaten' }), '2');
  await user.click(screen.getByRole('button', { name: 'Save food entry' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  const payload = create.mutateAsync.mock.calls[0][0];
  expect(payload).toEqual({
    requestId: expect.any(String),
    productId: productFixture.id,
    productVersion: 1,
    logDate: '2026-10-17',
    mealCategory: 'LUNCH',
    input: { quantity: '2', unit: 'SERVING', servingId: productFixture.servings[0].id },
  });
  expect(payload).not.toHaveProperty('calories');
});
