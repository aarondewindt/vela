jest.mock('@/hooks/auth', () => ({
  useAuth: () => ({ session: { data: { user: { id: 'alice' } } } }),
}));
const mockDevices = jest.fn();
const mockEvents = jest.fn();
const mockUploads = jest.fn();
const mockDetail = jest.fn();
const mockUpload = jest.fn();
jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    companion: {
      devices: { useQuery: (...a: unknown[]) => mockDevices(...a) },
      events: { useQuery: (...a: unknown[]) => mockEvents(...a) },
      uploads: { useQuery: (...a: unknown[]) => mockUploads(...a) },
      event: { useQuery: (...a: unknown[]) => mockDetail(...a) },
      upload: { useQuery: (...a: unknown[]) => mockUpload(...a) },
    },
  },
}));
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { CompanionDevTools } from './CompanionDevTools';
const state = (data: unknown) => ({ data, isLoading: false, error: null, refetch: jest.fn() });
beforeEach(() => {
  jest.clearAllMocks();
  mockDevices.mockReturnValue(state([]));
  mockEvents.mockReturnValue(state({ items: [], next: null }));
  mockUploads.mockReturnValue(state({ items: [], next: null }));
  mockDetail.mockReturnValue(state(undefined));
  mockUpload.mockReturnValue(state(undefined));
});
it('distinguishes empty server observations from device reports and exposes upload history', () => {
  render(<CompanionDevTools />);
  expect(screen.getByText(/No server requests match/)).toBeInTheDocument();
  expect(screen.getByText(/reported status is never live/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Diagnostic uploads'));
  expect(screen.getByText(/No diagnostic uploads match/)).toBeInTheDocument();
});
it('renders loading and recoverable request errors', () => {
  mockEvents.mockReturnValue({ ...state(undefined), isLoading: true });
  const { unmount } = render(<CompanionDevTools />);
  expect(screen.getByLabelText('Loading diagnostics')).toBeInTheDocument();
  unmount();
  mockEvents.mockReturnValue({ ...state(undefined), error: { message: 'Request unavailable' } });
  render(<CompanionDevTools />);
  expect(screen.getByText('Request unavailable')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Retry'));
  expect(mockEvents.mock.results.at(-1)!.value.refetch).toHaveBeenCalled();
});
it('shows unknown metadata honestly and opens protected details', () => {
  const id = '10000000-0000-4000-8000-000000000001';
  mockEvents.mockReturnValue(
    state({
      items: [
        {
          id,
          device: { name: 'Phone' },
          occurredAt: new Date(),
          trigger: 'unknown',
          status: 'failed',
          count: null,
          metrics: [],
          dateFrom: null,
          dateTo: null,
          durationMs: null,
          retry: null,
          replay: null,
        },
      ],
      next: null,
    })
  );
  mockDetail.mockReturnValue(
    state({
      id,
      attemptId: null,
      batchId: null,
      related: [],
      detail: { error: { category: 'BAD_REQUEST' } },
    })
  );
  render(<CompanionDevTools />);
  expect(screen.getAllByText('unknown').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByText('Details'));
  expect(screen.getByText('Private diagnostic details')).toBeInTheDocument();
  expect(screen.getByText('Download JSON')).toBeInTheDocument();
  expect(mockDetail).toHaveBeenLastCalledWith({ id }, { enabled: true });
});
it('resets page cursors on filter changes and validates date ranges', () => {
  const next = { at: '2026-01-01T00:00:00Z', id: '10000000-0000-4000-8000-000000000001' };
  mockEvents.mockReturnValue(state({ items: [], next }));
  render(<CompanionDevTools />);
  fireEvent.click(screen.getByText('Next'));
  expect(mockEvents.mock.calls.at(-1)[0].cursor).toEqual(next);
  fireEvent.change(screen.getByLabelText('From (UTC date)'), { target: { value: '2026-02-01' } });
  expect(mockEvents.mock.calls.at(-1)[0].cursor).toBeUndefined();
  fireEvent.change(screen.getByLabelText('Through (UTC date)'), {
    target: { value: '2026-01-01' },
  });
  expect(screen.getByText('Choose an ordered date range.')).toBeInTheDocument();
  expect(mockEvents.mock.calls.at(-1)[1].enabled).toBe(false);
});
