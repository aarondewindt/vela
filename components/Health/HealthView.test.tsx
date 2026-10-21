jest.mock('@mantine/charts', () => ({ LineChart: jest.fn(() => <div>History chart</div>) }));
jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: jest.fn(),
    health: {
      history: { useQuery: jest.fn() },
      saveGoal: { useMutation: jest.fn() },
      log: { useMutation: jest.fn() },
      remove: { useMutation: jest.fn() },
    },
    homeAssistant: { get: { useQuery: jest.fn() } },
  },
}));
import { LineChart } from '@mantine/charts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { HealthView } from './HealthView';
const save = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (trpc.useUtils as jest.Mock).mockReturnValue({ health: { history: { invalidate: jest.fn() } } });
  (trpc.health.history.useQuery as jest.Mock).mockReturnValue({
    data: {
      goal: { version: 0, calorieBalance: null },
      days: [
        {
          date: '2026-01-10',
          metrics: {
            WEIGHT: null,
            BODY_FAT: null,
            LEAN_MASS: null,
            SLEEP: null,
            TOTAL_CALORIES: null,
          },
          intake: null,
          burned: null,
          balance: null,
          differenceFromGoal: null,
        },
      ],
    },
  });
  (trpc.homeAssistant.get.useQuery as jest.Mock).mockReturnValue({ isSuccess: true, data: null });
  for (const mutation of [
    trpc.health.saveGoal.useMutation,
    trpc.health.log.useMutation,
    trpc.health.remove.useMutation,
  ]) {
    (mutation as jest.Mock).mockReturnValue({ mutate: save });
  }
});
it('shows missing data explicitly and persists a user-selected deficit goal', async () => {
  const user = userEvent.setup();
  render(<HealthView initialDate="2026-01-10" timezone="Europe/Amsterdam" />);
  expect(screen.getByText('Waiting for intake and total burn data')).toBeInTheDocument();
  expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
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

it('labels carried readings and offers deletion only on their original measurement date', () => {
  const query = trpc.health.history.useQuery as jest.Mock;
  const data = query.getMockImplementation()!().data;
  data.days[0].metrics.WEIGHT = {
    id: 'old',
    value: 80,
    measurementDate: '2026-01-01',
    carriedForward: true,
    observedAt: new Date('2026-01-01T12:00:00Z'),
    source: 'manual',
    timestampBasis: 'user_date',
  };
  query.mockReturnValue({ data });
  render(<HealthView initialDate="2026-01-10" timezone="Europe/Amsterdam" />);
  expect(screen.getAllByText('Carried forward from 2026-01-01')).toHaveLength(2);
  expect((LineChart as unknown as jest.Mock).mock.calls[0][0].data[0].weight).toBeNull();
  expect(screen.getByText(/Manual reading/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete manual reading' })).not.toBeInTheDocument();
});

it('configures a signed balance range and validates its inclusive bounds', async () => {
  const user = userEvent.setup();
  render(<HealthView initialDate="2026-01-10" timezone="Europe/Amsterdam" />);
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
