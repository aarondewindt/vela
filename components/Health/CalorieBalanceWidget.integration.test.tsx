import { screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { CalorieBalanceWidget } from './CalorieBalanceWidget';

const goal = {
  calorieBalance: -500,
  semantics: { kind: 'range' as const, upperBound: '-100', preferredTarget: '-200' },
};

it.each([-300, 0, 300])(
  'keeps the meter and marker description in kcal for balance %s',
  (balance) => {
    const label = `${balance < 0 ? '−' : '+'}${Math.abs(balance)} kcal`;
    const { container } = render(
      <CalorieBalanceWidget intake={1800} burned={2100} balance={balance} goal={goal} />
    );
    const meter = screen.getByRole('meter', { name: 'Current calorie balance' });
    expect(meter).toHaveAttribute('aria-valuenow', String(balance));
    expect(meter).toHaveAttribute('aria-valuetext', label);
    expect(meter).toHaveAccessibleDescription(`Current balance: ${label}`);
    expect(container.querySelectorAll('line')).toHaveLength(1);
    expect(screen.getAllByText(label)).toHaveLength(1);
  }
);

it('renders missing data without a marker or a fabricated meter value', () => {
  const { container } = render(
    <CalorieBalanceWidget intake={0} burned={null} balance={null} goal={goal} />
  );
  const image = screen.getByRole('img', { name: 'Current calorie balance' });
  expect(image).not.toHaveAttribute('aria-valuenow');
  expect(image).not.toHaveAttribute('aria-valuemin');
  expect(image).not.toHaveAttribute('aria-valuemax');
  expect(container.querySelector('line')).toBeNull();
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
  expect(screen.getByText('Not recorded')).toBeInTheDocument();
});
