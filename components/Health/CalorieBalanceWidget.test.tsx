jest.mock('@/components/VelaGaugeChart/VelaGaugeChart', () => ({
  VelaGaugeChart: jest.fn(({ label }) => <div>{label}</div>),
}));

import { VelaGaugeChart } from '@/components/VelaGaugeChart/VelaGaugeChart';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test-utils';
import { CalorieBalanceWidget } from './CalorieBalanceWidget';

const goal = {
  calorieBalance: -500,
  semantics: { kind: 'range' as const, upperBound: '-100', preferredTarget: '-200' },
};
const gauge = VelaGaugeChart as unknown as jest.Mock;
beforeEach(() => jest.clearAllMocks());

it('uses observed balance for the marker, gray/green sections and one signed center value', () => {
  render(<CalorieBalanceWidget intake={1800} burned={2100} balance={-300} goal={goal} />);
  expect(screen.getAllByText('−300 kcal')).toHaveLength(1);
  expect(screen.getByText('Consumed')).toBeInTheDocument();
  expect(screen.getByText('Burned')).toBeInTheDocument();
  expect(gauge.mock.calls[0][0]).toMatchObject({
    startAngle: -90,
    endAngle: 90,
    value: 45,
    markers: [{ id: 'current', value: 45, size: 3, label: 'Current balance' }],
    'aria-valuenow': -300,
    'aria-valuemin': -1200,
    'aria-valuemax': 800,
    sections: [
      { value: 35, color: 'gray.6' },
      { value: expect.closeTo(55), color: 'green.6' },
      { value: 100, color: 'gray.6' },
    ],
  });
});

it.each([0, 300])('shows an explicit sign for zero and surplus (%s)', (balance) => {
  render(<CalorieBalanceWidget intake={2100} burned={1800} balance={balance} goal={goal} />);
  expect(screen.getByText(`+${balance} kcal`)).toBeInTheDocument();
});

it('keeps partial data visible without a false zero or on-target band', () => {
  render(<CalorieBalanceWidget intake={0} burned={null} balance={null} goal={goal} />);
  expect(screen.getByText('0')).toBeInTheDocument();
  expect(screen.getByText('Not recorded')).toBeInTheDocument();
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
  expect(gauge.mock.calls[0][0]).toMatchObject({
    markers: [],
    role: 'img',
    'aria-valuenow': undefined,
    sections: [{ value: 100, color: 'gray.6' }],
  });
});

it.each([
  { calorieBalance: null },
  { calorieBalance: 0, semantics: { kind: 'target' as const } },
  { calorieBalance: -500, semantics: { kind: 'range' as const, upperBound: '-500' } },
  {
    calorieBalance: -500,
    semantics: { kind: 'range' as const, upperBound: '-100', preferredTarget: '0' },
  },
])('shows a neutral gauge for unsupported or invalid goal %j', (configuredGoal) => {
  render(<CalorieBalanceWidget intake={1800} burned={2100} balance={-300} goal={configuredGoal} />);
  expect(screen.getByText('−300 kcal')).toBeInTheDocument();
  expect(gauge.mock.calls[0][0].markers).toEqual([]);
  expect(gauge.mock.calls[0][0].sections).toEqual([{ value: 100, color: 'gray.6' }]);
});

it('uses the existing lower-bound preferred fallback for a range without a preferred target', () => {
  render(
    <CalorieBalanceWidget
      intake={1800}
      burned={2100}
      balance={-500}
      goal={{ calorieBalance: -500, semantics: { kind: 'range', upperBound: '-100' } }}
    />
  );
  expect(gauge.mock.calls[0][0].markers[0].value).toBe(50);
});

it('retains the current center and marker while adding a blue baseline marker', async () => {
  const projection = {
    derivation: 'observed_total_plus_remaining_bmr' as const,
    version: 'bmr-baseline-v1' as const,
    observedTotal: 2100,
    projectedTotal: 3000,
    cutoff: '2026-01-01T12:00:00Z',
    capturedAt: '2026-01-01T12:01:00Z',
    dayEnd: '2026-01-02T00:00:00Z',
    timezone: 'UTC',
    remainingDayFraction: 0.5,
    bmr: 1800,
    bmrObservedAt: '2025-12-30T12:00:00Z',
    ageMinutes: 1,
    assumptions: 'BMR only',
  };
  render(
    <CalorieBalanceWidget
      intake={1800.49}
      burned={2100.59}
      balance={-300.59}
      goal={goal}
      projection={projection}
    />
  );
  expect(screen.getByText('−301 kcal')).toBeInTheDocument();
  expect(screen.getByText('1,800')).toBeInTheDocument();
  expect(screen.getByText('2,101')).toBeInTheDocument();
  expect(screen.getByLabelText('Baseline projected balance')).toHaveTextContent('−1,200 kcal');
  expect(screen.queryByText(/Blue ·|No further food|Current:/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Surplus|Deficit|Balanced/)).not.toBeInTheDocument();
  expect(gauge.mock.calls[0][0].markers).toEqual([
    expect.objectContaining({ id: 'current', label: 'Current balance' }),
    expect.objectContaining({
      id: 'projected',
      label: 'Baseline projected balance',
      color: 'blue.5',
    }),
  ]);
  expect(gauge.mock.calls[0][0]['aria-valuenow']).toBe(-300.59);
  fireEvent.click(screen.getByRole('button', { name: 'Baseline projected balance' }));
  expect(await screen.findByRole('tooltip')).toHaveTextContent(
    'Preferred (−200 kcal): Eat 1,000 kcal'
  );
});

it('shows the burn capture time in a tooltip even when projection is unavailable', async () => {
  render(
    <CalorieBalanceWidget
      intake={1800}
      burned={2100}
      balance={-300}
      goal={goal}
      burnedUpdatedAt={new Date('2026-01-01T12:01:00Z')}
    />
  );
  fireEvent.focus(screen.getByText('2,100'));
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Last updated:');
  expect(screen.getByRole('tooltip')).toHaveTextContent('1 Jan 2026');
});

it('shows eat/burn differences for all three targets on click and dismisses outside', async () => {
  render(<CalorieBalanceWidget intake={1800} burned={2100} balance={-300} goal={goal} />);
  fireEvent.click(screen.getByRole('button', { name: 'Current balance' }));
  const tooltip = await screen.findByRole('tooltip');
  expect(tooltip).toHaveTextContent('Minimum (−500 kcal): Burn 200 kcal');
  expect(tooltip).toHaveTextContent('Preferred (−200 kcal): Eat 100 kcal');
  expect(tooltip).toHaveTextContent('Maximum (−100 kcal): Eat 200 kcal');
  fireEvent.mouseDown(document.body);
  await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
});

it('labels an exact preferred balance as at target and supports keyboard focus', async () => {
  render(<CalorieBalanceWidget intake={1800} burned={2000} balance={-200} goal={goal} />);
  fireEvent.focus(screen.getByRole('button', { name: 'Current balance' }));
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Preferred (−200 kcal): At target');
});
