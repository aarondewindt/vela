jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({}),
    nutrition: {
      searchProducts: {
        useQuery: jest.fn(() => ({
          isFetchedAfterMount: true,
          data: {
            matches: [],
            notice: 'Related-food search is unavailable. Showing text matches.',
          },
        })),
      },
    },
  },
}));
jest.mock('./ProductEditor', () => ({ ProductEditor: () => null }));
jest.mock('./ProductSuggestions', () => ({ ProductSuggestions: () => null }));
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { ProductPicker } from './ProductPicker';
it('enables related foods by default, exposes fallback and allows opting out', async () => {
  render(<ProductPicker value={null} disabled={false} onChange={jest.fn()} />);
  expect(screen.getByRole('switch', { name: 'Include related foods' })).toBeChecked();
  expect(trpc.nutrition.searchProducts.useQuery).toHaveBeenLastCalledWith(
    expect.objectContaining({ semantic: true }),
    expect.anything()
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Showing text matches');
  await userEvent.setup().click(screen.getByRole('switch', { name: 'Include related foods' }));
  expect(trpc.nutrition.searchProducts.useQuery).toHaveBeenLastCalledWith(
    expect.objectContaining({ semantic: false }),
    expect.anything()
  );
});
