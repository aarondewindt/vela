jest.mock('@/lib/trpc/client', () => ({
  trpc: { useUtils: jest.fn(), nutrition: { searchProducts: { useQuery: jest.fn() } } },
}));
jest.mock('./ProductEditor', () => ({ ProductEditor: () => null }));
jest.mock('./ProductSuggestions', () => ({ ProductSuggestions: () => null }));
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { ProductPicker } from './ProductPicker';
beforeEach(() => {
  jest.clearAllMocks();
  (trpc.nutrition.searchProducts.useQuery as jest.Mock).mockReturnValue({
    isFetchedAfterMount: true,
    data: { matches: [], notice: 'Related-food search is unavailable. Showing name matches.' },
  });
});
it('enables related-first ingredient search and allows opting out with a visible fallback', async () => {
  const user = userEvent.setup();
  render(<ProductPicker value={null} disabled={false} onChange={jest.fn()} relatedByDefault />);
  expect(trpc.nutrition.searchProducts.useQuery).toHaveBeenLastCalledWith(
    expect.objectContaining({ semantic: true, ranking: 'related-first' }),
    expect.anything()
  );
  expect(screen.getByRole('switch', { name: 'Include related foods' })).toBeChecked();
  expect(screen.getByRole('alert')).toHaveTextContent('Related-food search is unavailable');
  await user.click(screen.getByRole('switch', { name: 'Include related foods' }));
  expect(trpc.nutrition.searchProducts.useQuery).toHaveBeenLastCalledWith(
    expect.objectContaining({ semantic: false }),
    expect.anything()
  );
});
it('preserves conventional search defaults elsewhere', () => {
  render(<ProductPicker value={null} disabled={false} onChange={jest.fn()} />);
  expect(trpc.nutrition.searchProducts.useQuery).toHaveBeenLastCalledWith(
    expect.objectContaining({ semantic: false, ranking: 'text-first' }),
    expect.anything()
  );
});
