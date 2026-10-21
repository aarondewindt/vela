jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: jest.fn(),
    nutrition: { getGoals: { useQuery: jest.fn() }, saveGoals: { useMutation: jest.fn() } },
  },
}));
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { NutritionGoalsView } from './NutritionGoalsView';

const initial = { version: 0, calories: null, protein: null, carbohydrates: null, fat: null };
const mutateAsync = jest.fn();
const invalidate = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (trpc.useUtils as jest.Mock).mockReturnValue({
    nutrition: { getGoals: { invalidate }, getDiary: { invalidate } },
  });
  (trpc.nutrition.getGoals.useQuery as jest.Mock).mockReturnValue({
    data: initial,
    isFetchedAfterMount: true,
    error: null,
    refetch: jest.fn(),
  });
  (trpc.nutrition.saveGoals.useMutation as jest.Mock).mockReturnValue({
    mutateAsync,
    isPending: false,
    error: null,
  });
});
it('leaves targets empty until the user explicitly configures them', async () => {
  const user = userEvent.setup();
  mutateAsync.mockResolvedValue({ ...initial, version: 1, calories: '2400', protein: '160' });
  render(<NutritionGoalsView />);
  expect(screen.getByRole('textbox', { name: 'Calories (kcal)' })).toHaveValue('');
  await user.type(screen.getByRole('textbox', { name: 'Calories (kcal)' }), '2400');
  await user.type(screen.getByRole('textbox', { name: 'Protein (g)' }), '160');
  await user.click(screen.getByRole('button', { name: 'Save daily goals' }));
  await waitFor(() => expect(screen.getByText('Daily goals saved.')).toBeInTheDocument());
  expect(mutateAsync).toHaveBeenCalledWith({ ...initial, calories: '2400', protein: '160' });
  expect(invalidate).toHaveBeenCalledTimes(2);
});
it('rejects a zero goal without persisting or replacing the input', async () => {
  const user = userEvent.setup();
  render(<NutritionGoalsView />);
  await user.type(screen.getByRole('textbox', { name: 'Calories (kcal)' }), '0');
  await user.click(screen.getByRole('button', { name: 'Save daily goals' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Calories (kcal)' })).toHaveValue('0');
  expect(mutateAsync).not.toHaveBeenCalled();
});

it('edits minimum and range settings and rejects reversed bounds before saving', async () => {
  const user = userEvent.setup();
  render(<NutritionGoalsView />);
  await user.type(screen.getByRole('textbox', { name: 'Calories (kcal)' }), '2000');
  await user.click(screen.getByRole('combobox', { name: 'Calories (kcal) goal type' }));
  await user.click(screen.getByRole('option', { name: 'Range' }));
  const upper = screen.getByRole('textbox', { name: 'Calories (kcal) upper bound' });
  await user.type(upper, '1900');
  await user.click(screen.getByRole('button', { name: 'Save daily goals' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Range upper bound');
  expect(mutateAsync).not.toHaveBeenCalled();
  await user.clear(upper);
  await user.type(upper, '2200');
  await user.type(screen.getByRole('textbox', { name: 'Protein (g)' }), '160');
  await user.click(screen.getByRole('combobox', { name: 'Protein (g) goal type' }));
  await user.click(screen.getByRole('option', { name: 'Minimum' }));
  await user.click(screen.getByRole('button', { name: 'Save daily goals' }));
  expect(mutateAsync).toHaveBeenCalledWith({
    ...initial,
    calories: '2000',
    protein: '160',
    semantics: { calories: { kind: 'range', upperBound: '2200' }, protein: { kind: 'minimum' } },
  });
});
