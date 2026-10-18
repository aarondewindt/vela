jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: jest.fn(),
    nutrition: {
      listDrafts: { useQuery: jest.fn() },
      draftModels: { useQuery: jest.fn() },
      getDraft: { useQuery: jest.fn() },
      createDraft: { useMutation: jest.fn() },
      interpretDraft: { useMutation: jest.fn() },
    },
  },
}));
jest.mock('./MealDraftReview', () => ({ MealDraftReview: () => <div>Saved draft review</div> }));
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { MealDraftComposer } from './MealDraftComposer';
const id = '00000000-0000-4000-8000-000000000099';
const value = {
  id,
  revision: 2,
  status: 'DRAFT',
  generating: false,
  turns: [],
  selection: { provider: 'ollama', modelId: 'chat' },
};
const interpret = { mutateAsync: jest.fn(), reset: jest.fn(), isPending: false, error: null };
beforeAll(() => {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
  });
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
  });
});
beforeEach(() => {
  jest.clearAllMocks();
  (trpc.useUtils as jest.Mock).mockReturnValue({
    nutrition: {
      getDraft: { setData: jest.fn(), invalidate: jest.fn() },
      listDrafts: { invalidate: jest.fn() },
    },
  });
  (trpc.nutrition.getDraft.useQuery as jest.Mock).mockReturnValue({
    data: value,
    isFetchedAfterMount: true,
    error: null,
  });
  (trpc.nutrition.listDrafts.useQuery as jest.Mock).mockReturnValue({
    data: [],
    isFetchedAfterMount: true,
    error: null,
  });
  (trpc.nutrition.draftModels.useQuery as jest.Mock).mockReturnValue({ data: [], error: null });
  (trpc.nutrition.createDraft.useMutation as jest.Mock).mockReturnValue({
    mutateAsync: jest.fn(),
    reset: jest.fn(),
    isPending: false,
    error: null,
  });
  (trpc.nutrition.interpretDraft.useMutation as jest.Mock).mockReturnValue(interpret);
});
it('retains a message ID when retrying the same text after a lost response', async () => {
  const user = userEvent.setup();
  interpret.mutateAsync
    .mockRejectedValueOnce(new Error('Lost response'))
    .mockResolvedValueOnce(value);
  render(<MealDraftComposer date="2026-10-18" initialDraftId={id} onConfirmed={jest.fn()} />);
  await user.type(
    screen.getByRole('textbox', { name: 'Correct or extend this meal' }),
    'Make that 250 grams.'
  );
  await user.click(screen.getByRole('button', { name: 'Update meal draft' }));
  await waitFor(() => expect(interpret.mutateAsync).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole('button', { name: 'Update meal draft' }));
  await waitFor(() => expect(interpret.mutateAsync).toHaveBeenCalledTimes(2));
  expect(interpret.mutateAsync.mock.calls[0][0].requestId).toBe(
    interpret.mutateAsync.mock.calls[1][0].requestId
  );
});
it('keeps a new form intact when an older closed draft finishes asynchronously', async () => {
  const user = userEvent.setup();
  let finish: (result: unknown) => void = () => undefined;
  interpret.mutateAsync.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render(<MealDraftComposer date="2026-10-18" initialDraftId={id} onConfirmed={jest.fn()} />);
  await user.type(
    screen.getByRole('textbox', { name: 'Correct or extend this meal' }),
    'Previous meal message.'
  );
  await user.click(screen.getByRole('button', { name: 'Update meal draft' }));
  await user.click(screen.getByRole('button', { name: 'Close draft' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: 'Describe a meal' }));
  await user.type(
    screen.getByRole('textbox', { name: 'What did you eat?' }),
    'A new meal in progress.'
  );
  await act(async () => {
    finish(value);
  });
  expect(screen.getByRole('textbox', { name: 'What did you eat?' })).toHaveValue(
    'A new meal in progress.'
  );
});
