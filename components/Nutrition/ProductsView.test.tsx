jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ nutrition: { invalidate: jest.fn() } }),
    nutrition: {
      listProducts: { useQuery: jest.fn() },
      searchProducts: { useQuery: jest.fn() },
      setProductArchived: { useMutation: () => ({ error: null, isPending: false }) },
    },
  },
}));
jest.mock('./ProductSearchSettings', () => ({ ProductSearchSettings: () => null }));
jest.mock('./ProductEditor', () => ({
  ProductEditor: ({ initialCalculationMode }: { initialCalculationMode?: string }) => (
    <div
      role="dialog"
      aria-label={initialCalculationMode === 'CALCULATED' ? 'Recipe editor' : 'Product editor'}
    />
  ),
}));

import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { useNutritionProductsStore } from '@/store/nutrition_products_store';
import { productFixture } from '@/lib/nutrition/test-fixtures';
import { ProductsView } from './ProductsView';

beforeEach(() => {
  jest.clearAllMocks();
  useNutritionProductsStore.setState({ fuzzySearch: false });
  localStorage.clear();
  const result = { isFetchedAfterMount: true, error: null, isFetching: false };
  (trpc.nutrition.listProducts.useQuery as jest.Mock).mockReturnValue({
    ...result,
    data: { products: [], total: 0 },
  });
  (trpc.nutrition.searchProducts.useQuery as jest.Mock).mockReturnValue({
    ...result,
    data: { matches: [], notice: null },
  });
});

it('enables embedding search and remembers both switch choices after a reload', async () => {
  const user = userEvent.setup();
  const view = render(<ProductsView />);
  expect(screen.getByRole('switch', { name: /Fuzzy search/ })).not.toBeChecked();
  await user.type(screen.getByLabelText('Search products'), 'crispy snack');
  await user.click(screen.getByRole('switch', { name: /Fuzzy search/ }));
  await waitFor(() =>
    expect(trpc.nutrition.searchProducts.useQuery).toHaveBeenLastCalledWith(
      { query: 'crispy snack', limit: 50, semantic: true },
      expect.objectContaining({ enabled: true })
    )
  );
  const saved = localStorage.getItem('nutrition-products');
  expect(JSON.parse(saved!).state.fuzzySearch).toBe(true);
  view.unmount();

  // Simulate a fresh store while retaining browser storage.
  act(() => useNutritionProductsStore.setState({ fuzzySearch: false }));
  localStorage.setItem('nutrition-products', saved!);
  const revisit = render(<ProductsView />);
  expect(screen.getByRole('switch', { name: /Fuzzy search/ })).toBeChecked();
  await user.click(screen.getByRole('switch', { name: /Fuzzy search/ }));
  revisit.unmount();
  render(<ProductsView />);
  expect(screen.getByRole('switch', { name: /Fuzzy search/ })).not.toBeChecked();
  expect(JSON.parse(localStorage.getItem('nutrition-products')!).state.fuzzySearch).toBe(false);
});

it('keeps the saved choice while archived products use text search', async () => {
  const user = userEvent.setup();
  localStorage.setItem(
    'nutrition-products',
    JSON.stringify({ state: { fuzzySearch: true }, version: 0 })
  );
  render(<ProductsView />);
  await user.type(screen.getByLabelText('Search products'), 'milk');
  await user.click(screen.getByLabelText('Archived products'));
  expect(screen.getByRole('switch', { name: /Fuzzy search/ })).toBeDisabled();
  expect(screen.getByRole('switch', { name: /Fuzzy search/ })).toBeChecked();
  await waitFor(() =>
    expect(trpc.nutrition.listProducts.useQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'milk', archived: true }),
      expect.objectContaining({ enabled: true })
    )
  );
  expect(trpc.nutrition.searchProducts.useQuery).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ enabled: false })
  );
  await user.click(screen.getByLabelText('Archived products'));
  expect(screen.getByRole('switch', { name: /Fuzzy search/ })).toBeEnabled();
  expect(trpc.nutrition.searchProducts.useQuery).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ enabled: true })
  );
});

it('exposes recipe creation directly from the catalog', async () => {
  render(<ProductsView />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Create recipe' }));
  expect(screen.getByRole('dialog', { name: 'Recipe editor' })).toBeInTheDocument();
});

it('rounds recipe nutrients consistently in table and mobile cards without changing source values', () => {
  const product = {
    ...productFixture,
    calculationMode: 'CALCULATED',
    calories: '184.73913043',
    protein: '11.48695652',
    carbohydrates: '13.9173913',
    fat: '5.10652174',
    fiber: '0.12345678',
  };
  (trpc.nutrition.listProducts.useQuery as jest.Mock).mockReturnValue({
    isFetchedAfterMount: true,
    error: null,
    data: { products: [product], total: 1 },
  });
  render(<ProductsView />);
  expect(screen.getAllByText('184.7 kcal')).toHaveLength(2);
  expect(screen.getByText('P 11.5 · C 13.9 · F 5.1')).toBeInTheDocument();
  expect(screen.getByText('11.5 g')).toBeInTheDocument();
  expect(screen.getByText('13.9 g')).toBeInTheDocument();
  expect(screen.getByText('5.1 g')).toBeInTheDocument();
  expect(screen.getByText('Fiber: 0.1 g')).toBeInTheDocument();
  expect(product.calories).toBe('184.73913043');
});
