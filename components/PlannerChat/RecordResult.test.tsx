import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { RecordResult } from './RecordResult';
const mutate = jest.fn();
let row: any;
const invalidate = jest.fn();
jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      plannerChat: { getRecordPreview: { invalidate }, pendingRecordPreview: { invalidate } },
      planner: { invalidate },
      planningProposals: { invalidate },
      taskSearch: { invalidate },
      taskReviews: { invalidate },
    }),
    plannerChat: {
      getRecordPreview: { useQuery: () => ({ data: row }) },
      resolveRecordPreview: { useMutation: () => ({ mutate, isPending: false }) },
    },
  },
}));
const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  jest.clearAllMocks();
  row = {
    id,
    status: 'PENDING',
    accepted: false,
    stale: false,
    preview: {
      entity: 'task',
      action: 'delete',
      id,
      baseHash: 'hash',
      before: { title: 'Report' },
      patch: {},
      warnings: ['History links will be removed.'],
    },
  };
});
it('requires the deletion checkbox before sending an explicit confirmation', () => {
  render(<RecordResult conversationId={id} id={id} />);
  expect(screen.getByRole('button', { name: 'Confirm deletion' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  expect(mutate).toHaveBeenCalledWith({
    conversationId: id,
    id,
    action: 'accept',
    confirmDeletion: true,
  });
});
it('disables stale acceptance while preserving discard and revision', () => {
  row.stale = true;
  const revise = jest.fn();
  render(<RecordResult conversationId={id} id={id} onRevise={revise} />);
  expect(screen.queryByRole('button', { name: 'Confirm deletion' })).not.toBeInTheDocument();
  expect(screen.getByText(/records changed/i)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Discard record preview'));
  expect(mutate).toHaveBeenCalledWith({ conversationId: id, id, action: 'discard' });
  fireEvent.click(screen.getByText('Revise in chat'));
  expect(revise).toHaveBeenCalled();
});
it('restores accepted state without allowing a second mutation', () => {
  row.status = 'ACCEPTED';
  row.accepted = true;
  render(<RecordResult conversationId={id} id={id} />);
  expect(screen.getByText('Changes accepted.')).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByText('Discard record preview')).not.toBeInTheDocument();
});
