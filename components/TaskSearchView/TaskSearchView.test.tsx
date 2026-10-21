jest.mock('@mantine/modals', () => ({ modals: { openConfirmModal: jest.fn() } }));
jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: jest.fn(),
    taskSearch: {
      status: { useQuery: jest.fn() },
      models: { useQuery: jest.fn() },
      retry: { useMutation: jest.fn() },
      rebuild: { useMutation: jest.fn() },
      search: { useMutation: jest.fn() },
    },
  },
}));
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { TaskSearchView } from './TaskSearchView';
const configuration = { modelId: 'embed:1', dimensions: 1024 };
const data = {
  configuration,
  indexed: 2,
  total: 3,
  pending: 1,
  isMaintainer: false,
  busy: false,
  lastError: null,
};
const query = {
  isFetchedAfterMount: true,
  isPending: false,
  error: null,
  data,
  refetch: jest.fn(),
};
const index = { mutate: jest.fn(), reset: jest.fn(), isPending: false, error: null };
const rebuild = { mutate: jest.fn(), reset: jest.fn(), isPending: false, error: null };
const search = { mutate: jest.fn(), reset: jest.fn(), isPending: false, error: null };
beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = jest.fn();
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.releasePointerCapture = jest.fn();
  HTMLElement.prototype.scrollIntoView = jest.fn();
});
beforeEach(() => {
  jest.clearAllMocks();
  (trpc.useUtils as jest.Mock).mockReturnValue({
    taskSearch: { status: { invalidate: jest.fn() } },
  });
  (trpc.taskSearch.status.useQuery as jest.Mock).mockReturnValue(query);
  (trpc.taskSearch.models.useQuery as jest.Mock).mockReturnValue({
    isPending: false,
    isSuccess: true,
    data: [{ id: 'embed:1' }],
    error: null,
    refetch: jest.fn(),
  });
  (trpc.taskSearch.retry.useMutation as jest.Mock).mockReturnValue(index);
  (trpc.taskSearch.rebuild.useMutation as jest.Mock).mockReturnValue(rebuild);
  (trpc.taskSearch.search.useMutation as jest.Mock).mockReturnValue(search);
});
it('shows freshness and limits ordinary users to owner indexing', async () => {
  const user = userEvent.setup();
  render(<TaskSearchView />);
  expect(screen.getByText('2 of 3 tasks current · 1 need indexing')).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Embedding model' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Queue index refresh' }));
  expect(index.mutate).toHaveBeenCalledWith();
});
it('links maintainers to the centralized model settings', () => {
  (trpc.taskSearch.status.useQuery as jest.Mock).mockReturnValue({
    ...query,
    data: { ...data, isMaintainer: true },
  });
  render(<TaskSearchView />);
  expect(screen.getByRole('link', { name: 'Manage search models in Settings' })).toHaveAttribute(
    'href',
    '/settings#ai-models'
  );
  expect(screen.queryByRole('combobox', { name: 'Embedding model' })).not.toBeInTheDocument();
});
it('sends a bounded query without client-selected models or owners', async () => {
  const user = userEvent.setup();
  render(<TaskSearchView />);
  expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  await user.type(screen.getByRole('textbox', { name: 'Search query' }), ' dentist ');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect(search.mutate).toHaveBeenCalledWith({ query: 'dentist', limit: 10 });
});
it('shows ranked tasks and raw cosine scores', () => {
  (trpc.taskSearch.search.useMutation as jest.Mock).mockReturnValue({
    ...search,
    data: {
      configuration,
      results: [
        {
          id: 'a',
          title: 'Book dentist',
          brief: 'Annual checkup',
          status: 'BACKLOG',
          similarity: 0.75,
        },
      ],
    },
  });
  render(<TaskSearchView />);
  expect(screen.getByText('Book dentist')).toBeInTheDocument();
  expect(screen.getByText('Cosine 0.7500')).toBeInTheDocument();
});
it('hides cached private status and results until fresh authorization', () => {
  (trpc.taskSearch.status.useQuery as jest.Mock).mockReturnValue({
    ...query,
    isFetchedAfterMount: false,
  });
  (trpc.taskSearch.search.useMutation as jest.Mock).mockReturnValue({
    ...search,
    data: {
      configuration,
      results: [{ id: 'a', title: 'Private task', status: 'BACKLOG', similarity: 1 }],
    },
  });
  render(<TaskSearchView />);
  expect(screen.queryByText('Private task')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Queue index refresh' })).not.toBeInTheDocument();
});
it('disables indexing and search until configured', () => {
  (trpc.taskSearch.status.useQuery as jest.Mock).mockReturnValue({
    ...query,
    data: { ...data, configuration: null },
  });
  render(<TaskSearchView />);
  expect(screen.getByRole('button', { name: 'Queue index refresh' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
});
it('reports search errors and allows retry', async () => {
  (trpc.taskSearch.search.useMutation as jest.Mock).mockReturnValue({
    ...search,
    error: new Error('Check Ollama.'),
  });
  const user = userEvent.setup();
  render(<TaskSearchView />);
  expect(screen.getByText('Check Ollama.')).toBeInTheDocument();
  await user.type(screen.getByRole('textbox', { name: 'Search query' }), 'walk');
  expect(search.reset).toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect(search.mutate).toHaveBeenCalled();
});
it('disables index operations during a shared rebuild', () => {
  (trpc.taskSearch.status.useQuery as jest.Mock).mockReturnValue({
    ...query,
    data: { ...data, busy: true },
  });
  render(<TaskSearchView />);
  expect(screen.getByRole('button', { name: 'Queue index refresh' })).toBeDisabled();
  expect(screen.getByText(/Indexing is in progress/)).toBeInTheDocument();
});
