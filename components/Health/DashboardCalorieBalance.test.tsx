jest.mock('../Nutrition/MealDraftComposer', () => ({
  MealDraftComposer: () => <div>Meal composer</div>,
}));
jest.mock('@/lib/trpc/client', () => ({
  trpc: { useUtils: jest.fn(() => ({})), health: { history: { useQuery: jest.fn() } } },
}));
jest.mock('./CalorieBalanceWidget', () => ({
  CalorieBalanceWidget: jest.fn(() => <div>Balance gauge</div>),
}));

import { screen, fireEvent } from '@testing-library/react';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { CalorieBalanceWidget } from './CalorieBalanceWidget';
import { DashboardCalorieBalance } from './DashboardCalorieBalance';

const query = trpc.health.history.useQuery as jest.Mock;
const widget = CalorieBalanceWidget as jest.Mock;
const goal = { calorieBalance: -500, semantics: { kind: 'range', upperBound: '-100' } };
beforeEach(() => jest.clearAllMocks());

it('uses the existing Health query and passes today’s observed data to the shared widget', () => {
  query.mockReturnValue({
    isFetchedAfterMount: true,
    data: {
      goal,
      days: [{ date: '2026-10-25', intake: 1800, burned: 2100, balance: -300, metrics: {} }],
    },
  });
  render(<DashboardCalorieBalance date="2026-10-25" />);
  expect(query).toHaveBeenCalledWith(
    { endDate: '2026-10-25', days: 7 },
    expect.objectContaining({ refetchInterval: 30000 })
  );
  expect(widget.mock.calls[0][0]).toMatchObject({
    intake: 1800,
    burned: 2100,
    balance: -300,
    goal,
  });
  expect(screen.getByRole('link', { name: 'Open health dashboard' })).toHaveAttribute(
    'href',
    '/health'
  );
});

it('never substitutes historical burn for a missing current day', () => {
  query.mockReturnValue({
    isFetchedAfterMount: true,
    data: { goal, days: [{ date: '2026-10-24', intake: 1800, burned: 2100, balance: -300 }] },
  });
  render(<DashboardCalorieBalance date="2026-10-25" />);
  expect(widget.mock.calls[0][0]).toMatchObject({ intake: null, burned: null, balance: null });
});

it('waits for fresh authorized data and hides cached values on a retryable error', () => {
  query.mockReturnValue({ isFetchedAfterMount: false, data: { goal } });
  const view = render(<DashboardCalorieBalance date="2026-10-25" />);
  expect(screen.getByLabelText("Loading today's calorie balance")).toBeInTheDocument();
  expect(widget).not.toHaveBeenCalled();
  const refetch = jest.fn();
  query.mockReturnValue({
    isFetchedAfterMount: true,
    error: { message: 'Unavailable' },
    data: { goal },
    refetch,
  });
  view.rerender(<DashboardCalorieBalance date="2026-10-25" />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry calorie balance' }));
  expect(refetch).toHaveBeenCalled();
  expect(widget).not.toHaveBeenCalled();
});
