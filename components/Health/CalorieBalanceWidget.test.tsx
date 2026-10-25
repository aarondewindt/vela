jest.mock('@/components/VelaGaugeChart/VelaGaugeChart', () => ({
  VelaGaugeChart: jest.fn(({ label }) => <div>{label}</div>),
}));

import { VelaGaugeChart } from '@/components/VelaGaugeChart/VelaGaugeChart';
import { screen } from '@testing-library/react';
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
