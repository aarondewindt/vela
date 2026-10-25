jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    settings: { getAiModels: { useQuery: jest.fn() } },
    useUtils: jest.fn(),
    nutrition: {
      listDrafts: { useQuery: jest.fn() },
      draftModels: { useQuery: jest.fn() },
      getDraft: { useQuery: jest.fn() },
      createDraft: { useMutation: jest.fn() },
      changeDraftModel: { useMutation: jest.fn() },
      interpretDraft: { useMutation: jest.fn() },
    },
  },
}));
jest.mock('./MealDraftReview', () => ({
  MealDraftReview: ({
    onConfirmed,
    onClosed,
  }: {
    onConfirmed: (date: string) => Promise<void>;
    onClosed: () => void;
  }) => (
    <div>
      Saved draft review
      <button
        type="button"
        onClick={async () => {
          await onConfirmed('2026-10-21');
          onClosed();
        }}
      >
        Log reviewed meal
      </button>
    </div>
  ),
}));
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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
  override: { provider: 'ollama', modelId: 'chat' },
};
const interpret = { mutateAsync: jest.fn(), reset: jest.fn(), isPending: false, error: null };
it('creates a meal draft using settings without selecting another model', async () => {
  const create = jest.fn().mockResolvedValue(value);
  (trpc.nutrition.createDraft.useMutation as jest.Mock).mockReturnValue({
    mutateAsync: create,
    reset: jest.fn(),
  });
  (trpc.settings.getAiModels.useQuery as jest.Mock).mockReturnValue({
    isFetchedAfterMount: true,
    error: null,
    data: {
      resolved: { 'nutrition.mealDraft': { selection: value.selection, source: 'Default LLM' } },
    },
  });
  interpret.mutateAsync.mockResolvedValueOnce(value);
  const user = userEvent.setup();
  render(<MealDraftComposer date="2026-10-18" onConfirmed={jest.fn()} />);
  await user.click(screen.getByRole('button', { name: 'Describe a meal' }));
  expect(screen.getByRole('button', { name: 'Chat model' })).toHaveTextContent('chat · Default');
  await user.type(screen.getByRole('textbox', { name: 'What did you eat?' }), '100 grams of rice');
  await user.click(screen.getByRole('button', { name: 'Create meal draft' }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ selection: null }))
  );
});
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
  (trpc.settings.getAiModels.useQuery as jest.Mock).mockReturnValue({
    isFetchedAfterMount: true,
    error: null,
    data: { settings: {}, resolved: {} },
  });
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
  (trpc.nutrition.changeDraftModel.useMutation as jest.Mock).mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
    error: null,
  });
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

it('preserves Enter/newlines and submits a new meal with Shift+Enter only once', async () => {
  const user = userEvent.setup();
  let finish: (result: unknown) => void = () => undefined;
  const create = jest.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  (trpc.nutrition.createDraft.useMutation as jest.Mock).mockReturnValue({
    mutateAsync: create,
    reset: jest.fn(),
    isPending: false,
  });
  (trpc.settings.getAiModels.useQuery as jest.Mock).mockReturnValue({
    isFetchedAfterMount: true,
    error: null,
    data: {
      resolved: { 'nutrition.mealDraft': { selection: value.selection, source: 'Default LLM' } },
    },
  });
  interpret.mutateAsync.mockResolvedValueOnce(value);
  render(<MealDraftComposer date="2026-10-18" onConfirmed={jest.fn()} />);
  await user.click(screen.getByRole('button', { name: 'Describe a meal' }));
  const input = screen.getByRole('textbox', { name: 'What did you eat?' });
  await user.type(input, 'Rice{Enter}Chicken');
  expect(input).toHaveValue('Rice\nChicken');
  expect(create).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true, isComposing: true });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true, repeat: true });
  expect(create).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'Create meal draft' }));
  expect(create).toHaveBeenCalledTimes(1);
  await act(async () => finish(value));
  await waitFor(() => expect(interpret.mutateAsync).toHaveBeenCalledTimes(1));
  expect(interpret.mutateAsync).toHaveBeenCalledWith(
    expect.objectContaining({ text: 'Rice\nChicken' })
  );
});

it('uses Shift+Enter for corrections and blocks whitespace and generating drafts', async () => {
  const user = userEvent.setup();
  interpret.mutateAsync.mockResolvedValueOnce(value);
  render(<MealDraftComposer date="2026-10-18" initialDraftId={id} onConfirmed={jest.fn()} />);
  const input = screen.getByRole('textbox', { name: 'Correct or extend this meal' });
  await user.type(input, '   {Shift>}{Enter}{/Shift}');
  expect(interpret.mutateAsync).not.toHaveBeenCalled();
  await user.type(input, 'More rice{Shift>}{Enter}{/Shift}');
  await waitFor(() => expect(interpret.mutateAsync).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(input).toHaveValue(''));
  (trpc.nutrition.getDraft.useQuery as jest.Mock).mockReturnValue({
    data: { ...value, generating: true },
    isFetchedAfterMount: true,
    error: null,
  });
  await user.type(input, 'More chicken{Shift>}{Enter}{/Shift}');
  expect(interpret.mutateAsync).toHaveBeenCalledTimes(1);
});

it('opens the existing meal dialog from the compact dashboard button without navigating', async () => {
  window.history.replaceState(null, '', '/');
  const location = window.location.href;
  render(<MealDraftComposer date="2026-10-21" compact onConfirmed={jest.fn()} />);
  expect(screen.queryByText('Describe what you ate')).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Add meal' }));
  expect(await screen.findByRole('dialog', { name: 'Meal draft' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'What did you eat?' })).toBeInTheDocument();
  expect(window.location.href).toBe(location);
});

it('closes a confirmed dashboard meal without changing the page', async () => {
  window.history.replaceState(null, '', '/');
  const confirmed = jest.fn();
  render(
    <MealDraftComposer date="2026-10-21" compact initialDraftId={id} onConfirmed={confirmed} />
  );
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Log reviewed meal' }));
  await waitFor(() => expect(confirmed).toHaveBeenCalledWith('2026-10-21'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(window.location.pathname).toBe('/');
  expect(window.location.search).toBe('');
});

it('persists model changes from the shared composer with the draft revision', async () => {
  const mutate = jest.fn();
  (trpc.nutrition.changeDraftModel.useMutation as jest.Mock).mockReturnValue({ mutate });
  const user = userEvent.setup();
  render(<MealDraftComposer date="2026-10-18" initialDraftId={id} onConfirmed={jest.fn()} />);
  await user.click(screen.getByRole('button', { name: 'Chat model' }));
  await user.click(screen.getByRole('option', { name: /Use default/ }));
  expect(mutate).toHaveBeenCalledWith({ id, revision: value.revision, selection: null });
});
