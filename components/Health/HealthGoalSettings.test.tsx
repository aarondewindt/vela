jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: jest.fn(),
    health: { saveGoal: { useMutation: jest.fn() }, getGoal: { useQuery: jest.fn() } },
  },
}));
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { HealthGoalForm, HealthGoalSettings } from './HealthGoalSettings';
const save = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (trpc.health.saveGoal.useMutation as jest.Mock).mockReturnValue({ mutate: save });
  (trpc.useUtils as jest.Mock).mockReturnValue({
    health: { history: { invalidate: jest.fn() }, getGoal: { invalidate: jest.fn() } },
  });
});
it('persists a user-selected deficit or maintenance goal', async () => {
  const user = userEvent.setup();
  render(<HealthGoalForm initial={{ version: 0, calorieBalance: null }} />);
  const goal = screen.getByRole('textbox', { name: 'Goal (kcal per day)' });
  expect(goal).toHaveValue('');
  await user.type(goal, '-300');
  await user.click(screen.getByRole('button', { name: 'Save goal' }));
  expect(save).toHaveBeenCalledWith({
    version: 0,
    calorieBalance: -300,
    semantics: { kind: 'target' },
  });
  await user.clear(goal);
  await user.type(goal, '0');
  await user.click(screen.getByRole('button', { name: 'Save goal' }));
  expect(save).toHaveBeenLastCalledWith({
    version: 0,
    calorieBalance: 0,
    semantics: { kind: 'target' },
  });
});

it('configures a signed balance range and validates its inclusive bounds', async () => {
  const user = userEvent.setup();
  render(<HealthGoalForm initial={{ version: 0, calorieBalance: null }} />);
  await user.type(screen.getByRole('textbox', { name: 'Goal (kcal per day)' }), '-400');
  await user.click(screen.getByRole('combobox', { name: 'Calorie balance goal type' }));
  await user.click(screen.getByRole('option', { name: 'Range' }));
  const upper = screen.getByRole('textbox', { name: 'Calorie balance upper bound' });
  await user.type(upper, '-500');
  await user.click(screen.getByRole('button', { name: 'Save goal' }));
  expect(screen.getByText(/Use an ordered range/)).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
  await user.clear(upper);
  await user.type(upper, '-200');
  await user.type(
    screen.getByRole('textbox', { name: 'Calorie balance preferred target' }),
    '-300'
  );
  await user.click(screen.getByRole('button', { name: 'Save goal' }));
  expect(save).toHaveBeenCalledWith({
    version: 0,
    calorieBalance: -400,
    semantics: { kind: 'range', upperBound: '-200', preferredTarget: '-300' },
  });
});

it('hides cached goal settings until the request is authorized and offers a retry on failure', () => {
  const refetch = jest.fn();
  (trpc.health.getGoal.useQuery as jest.Mock).mockReturnValue({
    data: { version: 1, calorieBalance: -300 },
    isFetchedAfterMount: false,
  });
  const view = render(<HealthGoalSettings />);
  expect(screen.queryByRole('textbox', { name: 'Goal (kcal per day)' })).not.toBeInTheDocument();
  (trpc.health.getGoal.useQuery as jest.Mock).mockReturnValue({
    error: { message: 'Unavailable' },
    refetch,
  });
  view.rerender(<HealthGoalSettings />);
  expect(screen.getByRole('alert')).toHaveTextContent('Unavailable');
  expect(screen.getByRole('button', { name: 'Retry loading goal' })).toBeInTheDocument();
});
