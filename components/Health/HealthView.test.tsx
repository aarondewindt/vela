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
it('shows missing data and links to the single Health settings editor', () => {
  render(<HealthView initialDate="2026-01-10" timezone="Europe/Amsterdam" />);
  expect(screen.getByText('Waiting for intake and total burn data')).toBeInTheDocument();
  expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
  expect(screen.getByRole('link', { name: 'Edit health goals' })).toHaveAttribute(
    'href',
    '/settings/health'
  );
  expect(screen.queryByRole('button', { name: 'Save goal' })).not.toBeInTheDocument();
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

it('shows current metric and signed balance reference bands even with no observations', () => {
  const query = trpc.health.history.useQuery as jest.Mock;
  const data = query.getMockImplementation()!().data;
  data.goal = {
    calorieBalance: -400,
    semantics: { kind: 'range', upperBound: '-200' },
    metricGoals: {
      WEIGHT: { target: 80, semantics: { kind: 'range', upperBound: '85' } },
      BODY_FAT: { target: 20, semantics: { kind: 'maximum' } },
      SLEEP: { target: 8, semantics: { kind: 'minimum' } },
    },
  };
  query.mockReturnValue({ data });
  render(<HealthView initialDate="2026-01-10" timezone="Europe/Amsterdam" />);
  const charts = (LineChart as unknown as jest.Mock).mock.calls.map(([props]) => props);
  expect(charts[0].referenceAreas).toEqual([expect.objectContaining({ y1: 80, y2: 85 })]);
  expect(charts[1].referenceLines).toEqual([expect.objectContaining({ y: 20 })]);
  expect(charts[2].referenceLines).toEqual([expect.objectContaining({ y: 8 })]);
  expect(charts[3].referenceAreas).toEqual([expect.objectContaining({ y1: -400, y2: -200 })]);
  expect(charts[0].data[0].weight).toBeNull();
  for (const chart of charts) {
    for (const reference of [...chart.referenceLines, ...chart.referenceAreas]) {
      expect(reference).not.toHaveProperty('label');
      expect(chart.series.map((series: { color: string }) => series.color)).not.toContain(
        reference.color
      );
    }
  }
  expect(charts[1].referenceLines[0].color).toBe('red.6');
  expect(charts[2].referenceLines[0].color).toBe('yellow.6');
});

it('removes chart references when health targets are cleared', () => {
  const query = trpc.health.history.useQuery as jest.Mock;
  const data = query.getMockImplementation()!().data;
  data.goal = {
    calorieBalance: 0,
    semantics: { kind: 'target', tolerance: '100' },
    metricGoals: { SLEEP: { target: 8, semantics: { kind: 'range', upperBound: '9' } } },
  };
  query.mockReturnValue({ data });
  const view = render(<HealthView initialDate="2026-01-10" timezone="Europe/Amsterdam" />);
  const charts = LineChart as unknown as jest.Mock;
  expect(charts.mock.calls.at(-1)[0].referenceAreas).toEqual([
    expect.objectContaining({ y1: -100, y2: 100 }),
  ]);
  data.goal = { calorieBalance: null, metricGoals: {} };
  query.mockReturnValue({ data });
  view.rerender(<HealthView initialDate="2026-01-10" timezone="Europe/Amsterdam" />);
  for (const [props] of charts.mock.calls.slice(-4)) {
    expect(props.referenceAreas).toEqual([]);
    expect(props.referenceLines).toEqual([]);
  }
});
