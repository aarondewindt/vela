jest.mock('@prisma/client/runtime/client', () =>
  jest.requireActual('@prisma/client/runtime/index-browser')
);
jest.mock('@/lib/trpc/client', () => ({
  trpc: { nutrition: { getDiary: { useQuery: jest.fn() } } },
}));
import { act, fireEvent, screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { nutritionGoalProgress } from '@/lib/nutrition/calculations';
import { NutritionGoalsWidget } from './NutritionGoalsWidget';

function day() {
  return {
    entries: [{ id: 'entry' }],
    progress: nutritionGoalProgress(
      { calories: '2100', protein: '200', carbohydrates: '180', fat: '90', fiber: '30' },
      {
        calories: null,
        protein: '100',
        carbohydrates: '200',
        fat: '70',
        semantics: {
          protein: { kind: 'minimum' },
          carbohydrates: { kind: 'target', tolerance: '10' },
          fat: { kind: 'maximum' },
        },
      }
    ),
  };
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-21T12:00:00Z'));
  jest.clearAllMocks();
  (trpc.nutrition.getDiary.useQuery as jest.Mock).mockReturnValue({ data: day() });
});
afterEach(() => jest.useRealTimers());
const widget = <NutritionGoalsWidget initialDate="2026-10-21" timezone="Europe/Amsterdam" />;
it('shows exactly three macros with semantics-aware colors and an expanding marked scale', () => {
  render(widget);
  const bars = screen.getAllByRole('progressbar');
  expect(bars).toHaveLength(3);
  expect(bars[0]).toHaveAttribute('aria-valuetext', '200 g; Minimum 100 g; Goal reached!');
  expect(Number(bars[0].getAttribute('aria-valuemax'))).toBeGreaterThan(200);
  for (const [bar, color] of [
    [bars[0], 'green'],
    [bars[1], 'blue'],
    [bars[2], 'red'],
  ] as const) {
    expect(bar.style.getPropertyValue('--progress-section-color')).toContain(color);
  }
  expect(screen.getByRole('link', { name: 'Configure goals' })).toHaveAttribute(
    'href',
    '/settings/nutrition'
  );
  expect(screen.getByRole('link', { name: 'Open diary' })).toHaveAttribute(
    'href',
    '/nutrition?date=2026-10-21'
  );
});
it('reports empty logging and unset goals without inventing completion', () => {
  const data = day();
  data.entries = [];
  data.progress.protein.goal = null;
  (trpc.nutrition.getDiary.useQuery as jest.Mock).mockReturnValue({ data });
  render(widget);
  expect(screen.getByText('No food logged today.')).toBeInTheDocument();
  expect(screen.getByText('No goal set')).toBeInTheDocument();
  expect(
    screen.queryByRole('progressbar', { name: 'Protein goal progress' })
  ).not.toBeInTheDocument();
});
it('shows loading and retryable errors without displaying stale success', () => {
  const query = trpc.nutrition.getDiary.useQuery as jest.Mock;
  query.mockReturnValue({ isLoading: true });
  const view = render(widget);
  expect(screen.getByLabelText('Loading nutrition goals')).toBeInTheDocument();
  const refetch = jest.fn();
  query.mockReturnValue({ data: day(), error: { message: 'Could not load intake' }, refetch });
  view.rerender(widget);
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load intake');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(refetch).toHaveBeenCalled();
});
it('follows midnight in the saved timezone', () => {
  jest.setSystemTime(new Date('2026-10-21T21:59:50Z'));
  render(widget);
  act(() => jest.advanceTimersByTime(60_000));
  expect(trpc.nutrition.getDiary.useQuery).toHaveBeenLastCalledWith(
    { date: '2026-10-22' },
    expect.anything()
  );
});
