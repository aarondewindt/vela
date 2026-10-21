jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: jest.fn(),
    planner: {
      getMealPreferences: { useQuery: jest.fn() },
      saveMealPreferences: { useMutation: jest.fn() },
    },
  },
}));
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { DEFAULT_MEAL_PREFERENCES } from '@/lib/planner/meals';
import { MealSettings } from './MealSettings';
const mutate = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(trpc.useUtils)
    .mockReturnValue({ planner: { getMealPreferences: { invalidate: jest.fn() } } } as any);
  jest
    .mocked(trpc.planner.getMealPreferences.useQuery)
    .mockReturnValue({ data: { preferences: DEFAULT_MEAL_PREFERENCES, version: 3 } } as any);
  jest.mocked(trpc.planner.saveMealPreferences.useMutation).mockReturnValue({ mutate } as any);
});
it('edits each recurring meal independently and saves the preference version', async () => {
  const user = userEvent.setup();
  render(<MealSettings />);
  expect(screen.getByRole('switch', { name: 'Schedule breakfast' })).not.toBeChecked();
  await user.click(screen.getByRole('switch', { name: 'Schedule lunch' }));
  await user.clear(screen.getByLabelText('Lunch window start'));
  await user.type(screen.getByLabelText('Lunch window start'), '12:30');
  fireEvent.change(screen.getByLabelText('Lunch duration'), { target: { value: '30' } });
  await user.click(screen.getByRole('button', { name: 'Save meal preferences' }));
  expect(mutate).toHaveBeenCalledWith({
    version: 3,
    preferences: {
      ...DEFAULT_MEAL_PREFERENCES,
      LUNCH: { enabled: true, startMinute: 750, endMinute: 840, durationMinutes: 30 },
    },
  });
});
it('blocks impossible windows and keeps failures visible with a reload option', () => {
  jest
    .mocked(trpc.planner.saveMealPreferences.useMutation)
    .mockReturnValue({ mutate, error: { message: 'Meal preferences changed' } } as any);
  render(<MealSettings />);
  fireEvent.change(screen.getByLabelText('Lunch window end'), { target: { value: '12:01' } });
  expect(screen.getByRole('button', { name: 'Save meal preferences' })).toBeDisabled();
  expect(screen.getByText('Meal preferences changed')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reload saved meals' })).toBeInTheDocument();
  expect(mutate).not.toHaveBeenCalled();
});
it('shows loading and query failures with retry', () => {
  jest
    .mocked(trpc.planner.getMealPreferences.useQuery)
    .mockReturnValue({ error: { message: 'Unavailable' }, refetch: jest.fn() } as any);
  render(<MealSettings />);
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reload meal preferences' })).toBeInTheDocument();
});
