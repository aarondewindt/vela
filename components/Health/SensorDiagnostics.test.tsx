jest.mock('@/lib/trpc/client', () => ({
  trpc: { health: { diagnostics: { useQuery: jest.fn() } } },
}));
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { SensorDiagnostics } from './SensorDiagnostics';
const refetch = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
});
it('shows each saved sensor’s state, unit, rejection reason or converted reading, and allows refreshing', async () => {
  (trpc.health.diagnostics.useQuery as jest.Mock).mockReturnValue({
    refetch,
    data: {
      checkedAt: new Date('2026-01-10T12:00:00Z'),
      timezone: 'Europe/Amsterdam',
      sensors: [
        {
          metric: 'WEIGHT',
          entityId: 'sensor.weight',
          state: '80000',
          unit: 'g',
          issue: null,
          normalized: { value: '80.000000', date: '2026-01-10' },
          lastChanged: '2026-01-10T10:00:00Z',
          lastUpdated: '2026-01-10T11:00:00Z',
        },
        {
          metric: 'BODY_FAT',
          entityId: 'sensor.fat',
          state: 'unavailable',
          unit: '%',
          issue: 'Home Assistant reports this sensor as unavailable.',
          normalized: null,
        },
        {
          metric: 'LEAN_MASS',
          entityId: 'sensor.missing',
          state: null,
          unit: null,
          issue: 'Entity not found in Home Assistant.',
          normalized: null,
        },
      ],
    },
  });
  render(<SensorDiagnostics />);
  expect(screen.getByText('Entity: sensor.weight')).toBeInTheDocument();
  expect(screen.getByText(/Reported state: "80000" · Unit: "g"/)).toBeInTheDocument();
  expect(
    screen.getByText(/Converted reading: 80 kg · Assigned date: 2026-01-10/)
  ).toBeInTheDocument();
  expect(screen.getByText(/Last changed: 2026-01-10T10:00:00Z/)).toBeInTheDocument();
  expect(
    screen.getByText('Home Assistant reports this sensor as unavailable.')
  ).toBeInTheDocument();
  expect(screen.getAllByText('Cannot import')).toHaveLength(2);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh diagnostics' }));
  expect(refetch).toHaveBeenCalledTimes(1);
});
it('shows read failures and hides stale success data', () => {
  (trpc.health.diagnostics.useQuery as jest.Mock).mockReturnValue({
    refetch,
    error: { message: 'Home Assistant rejected the token.' },
    data: {
      checkedAt: new Date(),
      timezone: 'UTC',
      sensors: [{ metric: 'WEIGHT', entityId: 'stale.entity' }],
    },
  });
  render(<SensorDiagnostics />);
  expect(screen.getByText('Home Assistant rejected the token.')).toBeInTheDocument();
  expect(screen.queryByText('Entity: stale.entity')).not.toBeInTheDocument();
});
