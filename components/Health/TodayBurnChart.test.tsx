jest.mock('@mantine/charts', () => ({ LineChart: jest.fn(() => <div>Burn lines</div>) }));
import { LineChart } from '@mantine/charts';
import { screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { TodayBurnChart } from './TodayBurnChart';
import type { CalorieTimeline } from '@/lib/health/calorie-timeline';
const timeline: CalorieTimeline = {
  date: '2026-01-01',
  timezone: 'UTC',
  start: Date.parse('2026-01-01T00:00:00Z'),
  end: Date.parse('2026-01-02T00:00:00Z'),
  projection: null,
  reason: 'Samsung BMR unavailable',
  points: [
    {
      time: Date.parse('2026-01-01T12:00:00Z'),
      total: 1200,
      active: 200,
      resting: 1000,
      projected: null,
      capturedAt: '2026-01-01T12:01:00Z',
      issue: null,
    },
  ],
};
it('uses only supplied numeric timestamps and a distinct dotted projection series', () => {
  render(<TodayBurnChart timeline={timeline} />);
  const props = (LineChart as unknown as jest.Mock).mock.calls.at(-1)[0];
  expect(props.data).toBe(timeline.points);
  expect(props.xAxisProps).toMatchObject({
    type: 'number',
    domain: [timeline.start, timeline.end],
  });
  expect(props.connectNulls).toBe(false);
  expect(props.series).toContainEqual(
    expect.objectContaining({ name: 'projected', strokeDasharray: '3 5', color: 'blue.5' })
  );
  expect(screen.getByText(/Samsung BMR unavailable/)).toBeInTheDocument();
});
it('labels actual values and source capture time in the tooltip', () => {
  render(<TodayBurnChart timeline={timeline} />);
  const props = (LineChart as unknown as jest.Mock).mock.calls.at(-1)[0];
  render(props.tooltipProps.content({ payload: [{ payload: timeline.points[0] }] }));
  expect(screen.getByText('Observed total: 1,200 kcal')).toBeInTheDocument();
  expect(screen.getByText('Resting: 1,000 kcal')).toBeInTheDocument();
  expect(screen.getByText(/SDK capture: 12:01/)).toBeInTheDocument();
});
