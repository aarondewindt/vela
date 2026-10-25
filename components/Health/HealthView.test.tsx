jest.mock('@mantine/charts', () => ({
  BarChart: jest.fn(() => <div>History bar chart</div>),
  LineChart: jest.fn(() => <div>History chart</div>),
  GaugeChart: jest.fn(({ label }) => <div>{label}</div>),
}));
jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: jest.fn(),
    health: {
      history: { useQuery: jest.fn() },
      chartHistory: { useQuery: jest.fn() },
      saveGoal: { useMutation: jest.fn() },
      log: { useMutation: jest.fn() },
      remove: { useMutation: jest.fn() },
    },
    homeAssistant: { get: { useQuery: jest.fn() } },
  },
}));
import { BarChart, LineChart } from '@mantine/charts';
import { aggregateHealthHistory, type HistoryRecord } from '@/lib/health/history-aggregation';
import { useHealthHistoryStore } from '@/store/health-history';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { HealthView } from './HealthView';
const save = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  useHealthHistoryStore.setState({ range: '10d' });
  (trpc.useUtils as jest.Mock).mockReturnValue({
    health: { history: { invalidate: jest.fn() }, chartHistory: { invalidate: jest.fn() } },
  });
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
  (trpc.health.chartHistory.useQuery as jest.Mock).mockImplementation(() => {
    const days = (trpc.health.history.useQuery as jest.Mock).getMockImplementation()!().data.days;
    const startDate = days[0].date;
    const endDate = days.at(-1).date;
    const records = days.flatMap(
      (day: {
        date: string;
        metrics: Record<string, { value: number; carriedForward?: boolean; source: string }>;
      }) =>
        Object.entries(day.metrics).flatMap(([metric, record]) =>
          record && !record.carriedForward ? [{ ...record, metric, date: day.date }] : []
        )
    ) as HistoryRecord[];
    return {
      data: {
        startDate,
        endDate,
        ...aggregateHealthHistory(startDate, endDate, '9999-12-31', records, []),
      },
    };
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
  expect(screen.getByText('No total burn recorded for 2026-01-10')).toBeInTheDocument();
  expect(screen.queryByText(/Latest total in this period/)).not.toBeInTheDocument();
});

it('uses one persisted range for all eight charts and preserves it through the local Today view', () => {
  render(<HealthView initialDate="2026-01-10" timezone="Europe/Amsterdam" />);
  expect(screen.getAllByRole('combobox', { name: 'Health history range' })).toHaveLength(1);
  expect(trpc.health.chartHistory.useQuery).toHaveBeenLastCalledWith(
    { endDate: '2026-01-10', range: '10d' },
    { enabled: true, refetchInterval: 30000 }
  );
  fireEvent.click(screen.getByRole('combobox', { name: 'Health history range' }));
  fireEvent.click(screen.getByRole('option', { name: 'All time' }));
  expect(trpc.health.chartHistory.useQuery).toHaveBeenLastCalledWith(
    { endDate: '2026-01-10', range: 'all' },
    { enabled: true, refetchInterval: 30000 }
  );
  expect(JSON.parse(localStorage.getItem('health-history')!).state.range).toBe('all');
  expect(screen.getAllByRole('radio', { name: 'Today' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('radio', { name: 'Today' }));
  expect(screen.getByText('10-minute data unavailable')).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { name: 'Calorie balance' })).toHaveLength(2);
  fireEvent.click(screen.getByRole('radio', { name: 'History' }));
  expect(screen.queryByText('10-minute data unavailable')).not.toBeInTheDocument();
  expect(useHealthHistoryStore.getState().range).toBe('all');
  const calls = (LineChart as unknown as jest.Mock).mock.calls.slice(-6);
  const bars = (BarChart as unknown as jest.Mock).mock.calls.slice(-2);
  expect(calls).toHaveLength(6);
  for (const [props] of [...calls, ...bars]) {
    expect(props.data).toBe(bars[0][0].data);
  }
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

it('keeps body goal references but removes daily balance goals from multi-day sums', () => {
  const query = trpc.health.history.useQuery as jest.Mock;
  const data = query.getMockImplementation()!().data;
  data.goal = {
    calorieBalance: -400,
    semantics: { kind: 'range', upperBound: '-200' },
    metricGoals: { WEIGHT: { target: 80, semantics: { kind: 'range', upperBound: '85' } } },
  };
  const aggregated = aggregateHealthHistory('2026-01-01', '2026-07-01', '2026-07-02', [], []);
  (trpc.health.chartHistory.useQuery as jest.Mock).mockReturnValue({ data: aggregated });
  render(<HealthView initialDate="2026-01-10" timezone="Europe/Amsterdam" />);
  const lines = (LineChart as unknown as jest.Mock).mock.calls.slice(-6);
  expect(lines[0][0].referenceAreas).toEqual([expect.objectContaining({ y1: 80, y2: 85 })]);
  const bars = (BarChart as unknown as jest.Mock).mock.calls.slice(-2);
  expect(bars[0][0].type).toBe('stacked');
  expect(bars[0][0].series.map((series: { name: string }) => series.name)).toEqual([
    'resting',
    'active',
    'unsplit',
  ]);
  expect(bars[1][0].referenceAreas).toEqual([]);
  expect(bars[1][0].referenceLines).toEqual([]);
  expect(screen.getByText(/Daily balance goals are hidden for multi-day sums/)).toBeInTheDocument();
  const point = aggregated.points[1];
  render(bars[0][0].tooltipProps.content({ payload: [{ payload: point }] }));
  expect(screen.getByText('0/7 days with total burn · Partial period')).toBeInTheDocument();
  render(bars[1][0].tooltipProps.content({ payload: [{ payload: point }] }));
  expect(screen.getByText('Incomplete period; no total shown')).toBeInTheDocument();
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
  const charts = (LineChart as unknown as jest.Mock).mock.calls.slice(-6).map(([props]) => props);
  expect(charts).toHaveLength(6);
  expect(screen.getAllByText('History bar chart')).toHaveLength(2);
  expect(screen.getByRole('heading', { name: 'Weight' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Lean mass' })).toBeInTheDocument();
  expect(charts[0].series).toEqual([{ name: 'weight', label: 'Weight', color: 'teal.6' }]);
  expect(charts[1].series).toEqual([{ name: 'lean', label: 'Lean mass', color: 'blue.6' }]);
  expect(charts[1].unit).toBe(' kg');
  expect(charts[1].referenceLines).toEqual([]);
  expect(charts[1].referenceAreas).toEqual([]);
  expect(charts[0].referenceAreas).toEqual([expect.objectContaining({ y1: 80, y2: 85 })]);
  expect(charts[2].referenceLines).toEqual([expect.objectContaining({ y: 20 })]);
  expect(charts[3].referenceLines).toEqual([expect.objectContaining({ y: 8 })]);
  expect((BarChart as unknown as jest.Mock).mock.calls.at(-1)[0].referenceAreas).toEqual([
    expect.objectContaining({ y1: -400, y2: -200 }),
  ]);
  expect(charts[0].data[0].weight).toBeNull();
  for (const chart of charts) {
    expect(chart.yAxisProps.domain).toEqual(['auto', 'auto']);
    for (const reference of [...chart.referenceLines, ...chart.referenceAreas]) {
      expect(reference).not.toHaveProperty('label');
      expect(chart.series.map((series: { color: string }) => series.color)).not.toContain(
        reference.color
      );
    }
  }
  expect(charts[2].referenceLines[0].color).toBe('red.6');
  expect(charts[3].referenceLines[0].color).toBe('yellow.6');
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
  expect((BarChart as unknown as jest.Mock).mock.calls.at(-1)[0].referenceAreas).toEqual([
    expect.objectContaining({ y1: -100, y2: 100 }),
  ]);
  data.goal = { calorieBalance: null, metricGoals: {} };
  query.mockReturnValue({ data });
  view.rerender(<HealthView initialDate="2026-01-10" timezone="Europe/Amsterdam" />);
  for (const [props] of charts.mock.calls.slice(-5)) {
    expect(props.referenceAreas).toEqual([]);
    expect(props.referenceLines).toEqual([]);
  }
});

it('displays Samsung steps sleep active burn and real BMR with distinct units and provenance', () => {
  const query = trpc.health.history.useQuery as jest.Mock;
  const data = query.getMockImplementation()!().data;
  for (const [metric, value] of [
    ['STEPS', 12345],
    ['SLEEP', 8.5],
    ['ACTIVE_CALORIES', 400],
    ['BMR', 1700],
  ] as const) {
    data.days[0].metrics[metric] = {
      id: metric,
      value,
      measurementDate: '2026-01-10',
      carriedForward: false,
      observedAt: new Date('2026-01-10T12:00:00Z'),
      source: 'samsung_health',
      timestampBasis: 'sdk_query_capture',
      metadata: { timezone: 'Europe/Amsterdam', sourceObservedAt: '2026-01-10T10:00:00Z' },
    };
  }
  render(<HealthView initialDate="2026-01-10" timezone="Europe/Amsterdam" />);
  expect(screen.getAllByText('12,345 steps')).toHaveLength(2);
  expect(screen.getAllByText('1,700 kcal/day')).toHaveLength(2);
  expect(screen.getAllByText('8.5 hours')).toHaveLength(2);
  expect(screen.getAllByText('400 kcal')).toHaveLength(2);
  expect(screen.getByText(/imported BMR point/)).toBeInTheDocument();
  expect(screen.getByText('Waiting for intake and total burn data')).toBeInTheDocument();
});

it('explains a missing selected-day burn after historical sync and opens the recorded date', () => {
  const query = trpc.health.history.useQuery as jest.Mock;
  const data = query.getMockImplementation()!().data;
  const today = { ...data.days[0], date: '2026-10-25' };
  const metrics = { ...today.metrics };
  for (const [metric, value] of [
    ['WEIGHT', 80],
    ['BODY_FAT', 20],
    ['LEAN_MASS', 64],
    ['TOTAL_CALORIES', 2400],
    ['ACTIVE_CALORIES', 400],
    ['STEPS', 9000],
    ['SLEEP', 8],
    ['BMR', 1900],
  ] as const) {
    metrics[metric] = {
      id: metric,
      value,
      measurementDate: metric === 'BMR' ? '2026-05-30' : '2026-10-24',
      carriedForward: metric === 'BMR',
      observedAt: new Date('2026-10-25T00:17:00Z'),
      source: ['WEIGHT', 'BODY_FAT', 'LEAN_MASS'].includes(metric)
        ? 'home_assistant'
        : 'samsung_health',
      timestampBasis: 'sdk_query_capture',
    };
  }
  const yesterday = {
    ...today,
    date: '2026-10-24',
    metrics,
    burned: 2400,
    intake: 2000,
    balance: -400,
  };
  data.days = [yesterday, today];
  query.mockReturnValue({ data });
  render(<HealthView initialDate="2026-10-25" timezone="Europe/Amsterdam" />);
  expect(screen.getAllByText('Burned').length).toBeGreaterThan(0);
  expect(
    screen.getByText(/Latest total in this period: 2,400 kcal on 2026-10-24 · Samsung Health/)
  ).toBeInTheDocument();
  expect(screen.getByText('Waiting for intake and total burn data')).toBeInTheDocument();
  query.mockReturnValue({ data: { ...data, days: [yesterday] } });
  fireEvent.click(screen.getByRole('button', { name: 'View 2026-10-24' }));
  expect(query).toHaveBeenLastCalledWith(
    { endDate: '2026-10-24', days: 7 },
    { enabled: true, refetchInterval: 30000 }
  );
  expect(screen.getAllByText(/2,400/).length).toBeGreaterThan(0);
  expect(screen.getByText('−400 kcal')).toBeInTheDocument();
  expect(screen.queryByText(/No total burn recorded/)).not.toBeInTheDocument();
  expect(screen.getAllByText('Carried forward from 2026-05-30')).toHaveLength(2);
  expect(screen.getAllByText(/Home Assistant · sensor state time/)).toHaveLength(3);
  expect(screen.getAllByText(/Samsung Health ·/)).toHaveLength(5);
  expect(screen.queryByRole('button', { name: 'Delete manual reading' })).not.toBeInTheDocument();
});

it('renders an observed zero as recorded burn without a missing-date notice', () => {
  const query = trpc.health.history.useQuery as jest.Mock;
  const data = query.getMockImplementation()!().data;
  data.days[0].burned = 0;
  query.mockReturnValue({ data });
  render(<HealthView initialDate="2026-01-10" timezone="Europe/Amsterdam" />);
  expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  expect(screen.queryByText(/No total burn recorded/)).not.toBeInTheDocument();
});
