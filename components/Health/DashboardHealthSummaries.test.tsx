jest.mock('@/lib/trpc/client', () => ({ trpc: { health: { history: { useQuery: jest.fn() } } } }));
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { DashboardHealthSummaries } from './DashboardHealthSummaries';

const query = trpc.health.history.useQuery as jest.Mock;
beforeEach(() => query.mockReset());

it('keeps details hidden until each reading info button is clicked', async () => {
  query.mockReturnValue({
    isFetchedAfterMount: true,
    data: {
      goal: { metricGoals: { SLEEP: { target: 8, semantics: { kind: 'minimum' } } } },
      days: [
        {
          date: '2026-10-24',
          metrics: {
            SLEEP: { value: 7.5, measurementDate: '2026-10-24', source: 'samsung_health' },
          },
        },
        {
          date: '2026-10-25',
          metrics: {
            WEIGHT: { value: 80, measurementDate: '2026-09-01', source: 'home_assistant' },
            BODY_FAT: { value: 20, measurementDate: '2026-09-01', source: 'manual' },
            SLEEP: null,
          },
        },
      ],
    },
  });
  render(<DashboardHealthSummaries date="2026-10-25" />);
  expect(screen.getByText('80 kg')).toBeInTheDocument();
  expect(screen.getByText('20 %')).toBeInTheDocument();
  expect(screen.getByText('7.5 hours')).toBeInTheDocument();
  expect(screen.queryByText(/Latest known reading/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Goal:/)).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Weight details' }));
  expect(screen.getByText(/2026-09-01 · Latest known reading · Home Assistant/)).toBeVisible();
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Body fat details' }));
  expect(screen.getByText(/2026-09-01 · Latest known reading · Manual reading/)).toBeVisible();
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Sleep details' }));
  expect(screen.getByText(/2026-10-24 · Latest known reading · Samsung Health/)).toBeVisible();
  expect(screen.getByText(/Goal:.*8.*hours/)).toBeVisible();
  expect(query).toHaveBeenCalledWith(
    { endDate: '2026-10-25', days: 7 },
    { retry: false, refetchInterval: 30000, refetchOnMount: 'always' }
  );
});

it('keeps missing readings unknown while preserving measured zero', () => {
  query.mockReturnValue({
    isFetchedAfterMount: true,
    data: {
      goal: { metricGoals: {} },
      days: [
        {
          date: '2026-10-25',
          metrics: {
            WEIGHT: null,
            BODY_FAT: null,
            SLEEP: { value: 0, measurementDate: '2026-10-25', source: 'manual' },
          },
        },
      ],
    },
  });
  render(<DashboardHealthSummaries date="2026-10-25" />);
  expect(screen.getAllByText('Not recorded')).toHaveLength(2);
  expect(screen.getByText('0 hours')).toBeInTheDocument();
});

it('does not display cached summaries after a refresh failure', () => {
  query.mockReturnValue({
    error: { message: 'Unavailable' },
    isFetchedAfterMount: true,
    data: { days: [] },
  });
  render(<DashboardHealthSummaries date="2026-10-25" />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Could not load Health summaries: Unavailable'
  );
  expect(screen.queryByRole('heading', { name: 'Weight' })).not.toBeInTheDocument();
});
