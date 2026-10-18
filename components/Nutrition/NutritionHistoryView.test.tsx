jest.mock('@/lib/trpc/client', () => ({
  trpc: { nutrition: { getHistory: { useQuery: jest.fn() } } },
}));
jest.mock('@mantine/charts', () => ({
  LineChart: ({ data, connectNulls }: { data: unknown[]; connectNulls: boolean }) => (
    <div data-testid="chart" data-connect-nulls={String(connectNulls)}>
      {JSON.stringify(data)}
    </div>
  ),
}));
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { NutritionHistoryView } from './NutritionHistoryView';
const refetch = jest.fn();
beforeEach(() => jest.clearAllMocks());
it('renders missing days separately from logged zero and requests both chart periods', async () => {
  (trpc.nutrition.getHistory.useQuery as jest.Mock).mockReturnValue({
    isPending: false,
    error: null,
    data: {
      loggedDays: 1,
      totals: { calories: '0' },
      days: [
        { date: '2026-10-17', nutrients: null },
        {
          date: '2026-10-18',
          nutrients: { calories: '0', protein: '0', carbohydrates: '0', fat: '0' },
        },
      ],
    },
  });
  render(<NutritionHistoryView initialDate="2026-10-18" />);
  expect(screen.getAllByText('Not logged')).toHaveLength(4);
  expect(screen.getAllByText('0 kcal').length).toBeGreaterThan(0);
  screen
    .getAllByTestId('chart')
    .forEach((chart) => expect(chart).toHaveAttribute('data-connect-nulls', 'false'));
  await userEvent.setup().click(screen.getByText('30 days'));
  expect(trpc.nutrition.getHistory.useQuery).toHaveBeenLastCalledWith(
    { endDate: '2026-10-18', days: 30 },
    expect.anything()
  );
});
it('shows loading and recoverable errors', async () => {
  (trpc.nutrition.getHistory.useQuery as jest.Mock).mockReturnValue({
    isPending: true,
    error: null,
  });
  const view = render(<NutritionHistoryView initialDate="2026-10-18" />);
  expect(screen.getByText('Loading nutrition history…')).toBeInTheDocument();
  (trpc.nutrition.getHistory.useQuery as jest.Mock).mockReturnValue({
    isPending: false,
    error: { message: 'Try later' },
    refetch,
  });
  view.rerender(<NutritionHistoryView initialDate="2026-10-18" />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry history' }));
  expect(refetch).toHaveBeenCalled();
});
