jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    nutrition: {
      getHistory: { useQuery: jest.fn() },
      getGoals: { useQuery: jest.fn(() => ({ data: undefined })) },
    },
  },
}));
jest.mock('@mantine/charts', () => ({
  LineChart: ({
    data,
    connectNulls,
    valueFormatter,
    referenceLines,
    referenceAreas,
  }: {
    data: unknown[];
    referenceLines: unknown[];
    referenceAreas: unknown[];
    connectNulls: boolean;
    valueFormatter: (value: number) => string;
  }) => (
    <div
      data-testid="chart"
      data-lines={JSON.stringify(referenceLines)}
      data-areas={JSON.stringify(referenceAreas)}
      data-connect-nulls={String(connectNulls)}
      data-formatted={valueFormatter(184.73913043)}
    >
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
  expect(screen.getAllByText('Not logged')).toHaveLength(5);
  expect(screen.getByText('Unknown')).toBeInTheDocument();
  expect(screen.getAllByText('0 kcal').length).toBeGreaterThan(0);
  screen.getAllByTestId('chart').forEach((chart) => {
    expect(chart).toHaveAttribute('data-connect-nulls', 'false');
    expect(chart).toHaveAttribute('data-formatted', '184.7');
  });
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

it('renders separate nutrient goals and ranges, including fiber, while preserving gaps', () => {
  (trpc.nutrition.getGoals.useQuery as jest.Mock).mockReturnValue({
    data: {
      calories: '2000',
      protein: '160',
      fat: '50',
      carbohydrates: null,
      fiber: '35',
      semantics: { fat: { kind: 'range', upperBound: '70' }, fiber: { kind: 'minimum' } },
    },
  });
  (trpc.nutrition.getHistory.useQuery as jest.Mock).mockReturnValue({
    data: {
      loggedDays: 0,
      totals: { calories: '0' },
      days: [{ date: '2026-10-18', nutrients: null }],
    },
  });
  const view = render(<NutritionHistoryView initialDate="2026-10-18" />);
  const charts = screen.getAllByTestId('chart');
  expect(charts).toHaveLength(5);
  for (const chart of charts) {
    expect(chart.getAttribute('data-lines')).not.toContain('"label"');
    expect(chart.getAttribute('data-areas')).not.toContain('"label"');
  }
  expect(charts[1]).toHaveAttribute('data-lines', expect.stringContaining('green.6'));
  expect(charts[2]).toHaveAttribute('data-lines', '[]');
  expect(charts[3]).toHaveAttribute('data-areas', expect.stringContaining('"y2":70'));
  expect(charts[4]).toHaveAttribute('data-lines', expect.stringContaining('yellow.6'));
  expect(charts[4]).toHaveTextContent('"fiber":null');
  (trpc.nutrition.getGoals.useQuery as jest.Mock).mockReturnValue({
    data: {
      calories: null,
      protein: null,
      fat: null,
      carbohydrates: null,
      fiber: null,
      semantics: {},
    },
  });
  view.rerender(<NutritionHistoryView initialDate="2026-10-18" />);
  for (const chart of screen.getAllByTestId('chart')) {
    expect(chart).toHaveAttribute('data-lines', '[]');
    expect(chart).toHaveAttribute('data-areas', '[]');
  }
});
