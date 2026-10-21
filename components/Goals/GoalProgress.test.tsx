import { screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { GoalProgress } from './GoalProgress';

it('keeps the actual amount, desired bounds and status accessible when the scale expands', () => {
  const view = render(
    <GoalProgress label="Protein" value="200" target="100" options={{ kind: 'minimum' }} unit="g" />
  );
  const bar = screen.getByRole('progressbar', { name: 'Protein goal progress' });
  expect(bar).toHaveAttribute('aria-valuetext', '200 g; Minimum 100 g; Goal reached!');
  expect(bar).toHaveAttribute('aria-valuenow', '200');
  expect(Number(bar.getAttribute('aria-valuemax'))).toBeGreaterThan(200);
  view.rerender(
    <GoalProgress label="Protein" value="200" target="100" options={{ kind: 'maximum' }} unit="g" />
  );
  expect(screen.getByRole('progressbar', { name: 'Protein goal progress' })).toHaveAttribute(
    'aria-valuetext',
    '200 g; At most 100 g; Above goal'
  );
});

it.each([
  ['50', 'blue'],
  ['100', 'green'],
  ['200', 'red'],
])('uses the compact dashboard colors for exact targets at %s', (value, color) => {
  render(
    <GoalProgress
      label="Fat"
      value={value}
      target="100"
      options={{ kind: 'target' }}
      unit="g"
      compact
    />
  );
  expect(screen.getByRole('progressbar')).toHaveStyle({
    '--progress-section-color': `var(--mantine-color-${color}-filled)`,
  });
});
