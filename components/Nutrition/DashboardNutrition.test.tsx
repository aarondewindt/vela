jest.mock('@prisma/client/runtime/client', () =>
  jest.requireActual('@prisma/client/runtime/index-browser')
);
jest.mock('@/lib/trpc/client', () => ({
  trpc: { nutrition: { getDiary: { useQuery: jest.fn() } } },
}));
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { nutritionGoalProgress, sumNutrition } from '@/lib/nutrition/calculations';
import { DashboardNutrition } from './DashboardNutrition';

it('shows the live daily summary including fiber goals and marked bars on the dashboard', () => {
  const totals = sumNutrition([
    { calories: '2000', protein: '150', fat: '60', carbohydrates: '250', fiber: '30' },
  ]);
  const goals = {
    version: 1,
    calories: null,
    protein: '160',
    fat: '70',
    carbohydrates: '250',
    fiber: '35',
    semantics: {},
  };
  (trpc.nutrition.getDiary.useQuery as jest.Mock).mockReturnValue({
    isFetchedAfterMount: true,
    data: {
      date: '2026-10-21',
      entries: [],
      totals,
      goals,
      progress: nutritionGoalProgress(totals, goals),
    },
  });
  render(<DashboardNutrition date="2026-10-21" />);
  expect(trpc.nutrition.getDiary.useQuery).toHaveBeenCalledWith(
    { date: '2026-10-21' },
    expect.anything()
  );
  expect(screen.getByRole('progressbar', { name: 'Fiber goal progress' })).toHaveAttribute(
    'aria-valuenow',
    '30'
  );
  expect(screen.getByText('30 / ≥35 g')).toBeInTheDocument();
  expect(screen.getAllByRole('progressbar')).toHaveLength(4);
  expect(screen.getByText(/2,000 kcal logged/)).toBeInTheDocument();
  const fiberBar = screen.getByRole('progressbar', { name: 'Fiber goal progress' });
  const marker = fiberBar.closest('[title]')!.querySelector('span[aria-hidden="true"]');
  expect(marker).toHaveStyle({ left: '75%' });
  expect(screen.getByRole('link', { name: 'Edit nutrition goals' })).toHaveAttribute(
    'href',
    '/settings/nutrition'
  );
});
it('shows loading and retryable errors instead of an empty dashboard', async () => {
  const query = trpc.nutrition.getDiary.useQuery as jest.Mock;
  query.mockReturnValue({
    isPending: true,
    isFetchedAfterMount: false,
    data: { privateCachedValue: 'hide until authorized' },
  });
  const view = render(<DashboardNutrition date="2026-10-21" />);
  expect(screen.getByLabelText("Loading today's nutrition")).toBeInTheDocument();
  const refetch = jest.fn();
  query.mockReturnValue({ error: { message: 'Unavailable' }, refetch });
  view.rerender(<DashboardNutrition date="2026-10-21" />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry nutrition' }));
  expect(refetch).toHaveBeenCalled();
});

it('preserves unknown fiber and goal markers without presenting unknown intake as zero', () => {
  const totals = sumNutrition([
    { calories: '500', protein: '20', fat: '10', carbohydrates: '70', fiber: null },
  ]);
  const goals = {
    version: 1,
    calories: null,
    protein: null,
    fat: null,
    carbohydrates: null,
    fiber: '35',
    semantics: {},
  };
  (trpc.nutrition.getDiary.useQuery as jest.Mock).mockReturnValue({
    isFetchedAfterMount: true,
    data: {
      date: '2026-10-21',
      entries: [],
      totals,
      goals,
      progress: nutritionGoalProgress(totals, goals),
    },
  });
  const view = render(<DashboardNutrition date="2026-10-21" />);
  expect(screen.getAllByText('No goal')).toHaveLength(3);
  const fiber = screen.getByRole('progressbar', { name: 'Fiber goal progress' });
  expect(fiber).not.toHaveAttribute('aria-valuenow');
  expect(fiber).toHaveAttribute('aria-valuetext', 'Unknown g; Minimum 35 g; Waiting for data');
  expect(fiber.closest('[title]')!.querySelector('span[aria-hidden="true"]')).toHaveStyle({
    left: '75%',
  });
  expect(screen.getByText('Unknown / ≥35 g')).toBeInTheDocument();
  expect(screen.getByText('Fiber: at least 0 g; some entries are unknown.')).toBeInTheDocument();
  // Clearing the target removes its marker without inventing a default.
  (trpc.nutrition.getDiary.useQuery as jest.Mock).mockReturnValue({
    isFetchedAfterMount: true,
    data: { totals, progress: nutritionGoalProgress(totals, { ...goals, fiber: null }) },
  });
  view.rerender(<DashboardNutrition date="2026-10-21" />);
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.getAllByText('No goal')).toHaveLength(4);
});
