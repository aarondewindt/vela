/* eslint-disable no-script-url -- Tests verify rejection of unsafe URLs. */
jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: jest.fn(),
    discover: {
      list: { useQuery: jest.fn() },
      types: { useQuery: jest.fn() },
      quickAdd: { useMutation: jest.fn() },
      create: { useMutation: jest.fn() },
      update: { useMutation: jest.fn() },
      setStatus: { useMutation: jest.fn() },
      remove: { useMutation: jest.fn() },
    },
  },
}));
jest.mock('@mantine/modals', () => ({ modals: { openConfirmModal: jest.fn() } }));

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { modals } from '@mantine/modals';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { itemFixture } from '@/lib/discover/test-fixtures';
import { DiscoverView } from './DiscoverView';

const refresh = jest.fn().mockResolvedValue(undefined);
const create = jest.fn();
const update = jest.fn();
const quickAdd = jest.fn();
const setStatus = jest.fn();
const remove = jest.fn();
beforeAll(() => {
  Object.defineProperty(document, 'fonts', { value: new EventTarget(), configurable: true });
  HTMLElement.prototype.hasPointerCapture = jest.fn();
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.releasePointerCapture = jest.fn();
});
afterAll(() => {
  Reflect.deleteProperty(document, 'fonts');
});

const result = {
  isFetchedAfterMount: true,
  isLoading: false,
  isFetching: false,
  error: null,
  refetch: jest.fn(),
};
beforeEach(() => {
  jest.clearAllMocks();
  (trpc.useUtils as jest.Mock).mockReturnValue({ discover: { invalidate: refresh } });
  (trpc.discover.list.useQuery as jest.Mock).mockReturnValue({
    ...result,
    data: { items: [itemFixture], total: 1 },
  });
  (trpc.discover.types.useQuery as jest.Mock).mockReturnValue({ ...result, data: ['Museum'] });
  for (const [name, mutate] of [
    ['create', create],
    ['update', update],
  ] as const) {
    (trpc.discover[name].useMutation as jest.Mock).mockReturnValue({
      mutate,
      error: null,
      isPending: false,
    });
    mutate.mockImplementation((_input, options) => {
      void options?.onSuccess();
    });
  }
  for (const [name, mutate] of [
    ['quickAdd', quickAdd],
    ['setStatus', setStatus],
    ['remove', remove],
  ] as const) {
    (trpc.discover[name].useMutation as jest.Mock).mockImplementation((options) => ({
      mutate: (input: unknown) => {
        mutate(input);
        void options?.onSuccess();
      },
      error: null,
      isPending: false,
    }));
  }
});

it('quick adds with a title or URL and leaves optional details for later', async () => {
  const user = userEvent.setup();
  render(<DiscoverView />);
  await user.type(
    screen.getByRole('textbox', { name: 'Title or URL' }),
    'https://example.com/game'
  );
  await user.click(screen.getByRole('button', { name: 'Add item' }));
  expect(quickAdd).toHaveBeenCalledWith({ text: 'https://example.com/game', contentType: 'Other' });
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Title or URL' })).toHaveValue('')
  );
  expect(refresh).toHaveBeenCalled();
});
it('opens a minimal create form and saves optional details including notes, rating and custom type', async () => {
  const user = userEvent.setup();
  render(<DiscoverView />);
  await user.click(screen.getByRole('button', { name: 'Add with details' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), {
    target: { value: 'Visit NEMO' },
  });
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'Content type' }), {
    target: { value: 'Museum' },
  });
  fireEvent.change(within(dialog).getByLabelText('Personal notes'), {
    target: { value: 'Go on a quiet day' },
  });
  fireEvent.change(within(dialog).getByLabelText('Personal rating (0–10)'), {
    target: { value: '0' },
  });
  await user.click(within(dialog).getByRole('button', { name: 'Save item' }));
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Visit NEMO',
      contentType: 'Museum',
      notes: 'Go on a quiet day',
      rating: 0,
      url: null,
      status: 'WANT_TO_EXPLORE',
    }),
    expect.anything()
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
it('shows saved details and edits with the original concurrency version', async () => {
  const user = userEvent.setup();
  render(<DiscoverView />);
  await user.click(screen.getByRole('button', { name: 'Details & edit' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue('Dune');
  expect(within(dialog).getByText(/Added .*Updated/)).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText('Personal notes'), {
    target: { value: 'Start this weekend' },
  });
  await user.click(within(dialog).getByRole('button', { name: 'Save item' }));
  expect(update).toHaveBeenCalledWith(
    {
      id: itemFixture.id,
      version: 1,
      item: expect.objectContaining({ title: 'Dune', notes: 'Start this weekend' }),
    },
    expect.anything()
  );
});
it('changes status directly and requires confirmation before deletion', async () => {
  const user = userEvent.setup();
  render(<DiscoverView />);
  await user.click(screen.getByRole('combobox', { name: 'Status for Dune' }));
  await user.click(screen.getByRole('option', { name: 'Completed' }));
  expect(setStatus).toHaveBeenCalledWith({ id: itemFixture.id, version: 1, status: 'COMPLETED' });
  await user.click(screen.getByRole('button', { name: 'Delete Dune' }));
  expect(remove).not.toHaveBeenCalled();
  const confirmation = (modals.openConfirmModal as jest.Mock).mock.calls[0][0];
  expect(confirmation.labels).toEqual({ confirm: 'Delete item', cancel: 'Cancel' });
  confirmation.onConfirm();
  expect(remove).toHaveBeenCalledWith({ id: itemFixture.id, version: 1 });
});
it('passes search, type, status, tag, priority and sorting to server queries and resets filters', async () => {
  const user = userEvent.setup();
  render(<DiscoverView />);
  fireEvent.change(screen.getByLabelText('Search collection'), { target: { value: 'space' } });
  await user.click(screen.getByRole('combobox', { name: 'Content type' }));
  await user.click(screen.getByRole('option', { name: 'Book' }));
  await user.click(screen.getByRole('combobox', { name: 'Status' }));
  await user.click(screen.getByRole('option', { name: 'In Progress' }));
  fireEvent.change(screen.getByLabelText('Tag', { exact: true }), { target: { value: 'sci-fi' } });
  await user.click(screen.getByRole('combobox', { name: 'Priority' }));
  await user.click(screen.getByRole('option', { name: 'High' }));
  await user.click(screen.getByRole('combobox', { name: 'Sort by' }));
  await user.click(screen.getByRole('option', { name: 'Highest priority' }));
  await waitFor(() =>
    expect(trpc.discover.list.useQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: 'space',
        contentType: 'Book',
        status: 'IN_PROGRESS',
        tag: 'sci-fi',
        priority: 3,
        sort: 'priority',
        offset: 0,
      }),
      expect.anything()
    )
  );
  await user.click(screen.getByRole('button', { name: 'Clear filters' }));
  await waitFor(() =>
    expect(trpc.discover.list.useQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: '',
        contentType: undefined,
        status: undefined,
        tag: undefined,
        priority: undefined,
      }),
      expect.anything()
    )
  );
});
it('keeps details in place on validation or server failure', async () => {
  const user = userEvent.setup();
  (trpc.discover.create.useMutation as jest.Mock).mockReturnValue({
    mutate: create,
    isPending: false,
    error: { message: 'This URL is already in your Discover collection.' },
  });
  render(<DiscoverView />);
  await user.click(screen.getByRole('button', { name: 'Add with details' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), {
    target: { value: 'Item' },
  });
  fireEvent.change(within(dialog).getByLabelText('URL', { exact: true }), {
    target: { value: 'javascript:alert(1)' },
  });
  await user.click(within(dialog).getByRole('button', { name: 'Save item' }));
  expect(create).not.toHaveBeenCalled();
  expect(screen.getByText('Check item details')).toBeInTheDocument();
  expect(screen.getByText('This URL is already in your Discover collection.')).toBeInTheDocument();
  expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue('Item');
});
it('hides cached data until fetched after mount, and on failed authorization', () => {
  (trpc.discover.list.useQuery as jest.Mock).mockReturnValue({
    ...result,
    isFetchedAfterMount: false,
    data: { items: [itemFixture], total: 1 },
  });
  const view = render(<DiscoverView />);
  expect(screen.queryByRole('button', { name: 'Dune' })).not.toBeInTheDocument();
  (trpc.discover.list.useQuery as jest.Mock).mockReturnValue({
    ...result,
    error: { message: 'UNAUTHORIZED' },
    data: { items: [itemFixture], total: 1 },
  });
  view.rerender(<DiscoverView />);
  expect(screen.getByText('UNAUTHORIZED')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Dune' })).not.toBeInTheDocument();
});
it('shows empty collection and filtered empty states', async () => {
  (trpc.discover.list.useQuery as jest.Mock).mockReturnValue({
    ...result,
    data: { items: [], total: 0 },
  });
  render(<DiscoverView />);
  expect(screen.getByText('Your next discovery starts here.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search collection'), { target: { value: 'missing' } });
  expect(screen.getByText('No items match your filters.')).toBeInTheDocument();
});
