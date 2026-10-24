jest.mock('@ai-sdk/react', () => ({ useChat: jest.fn() }));
jest.mock('ai', () => ({ DefaultChatTransport: jest.fn() }));
jest.mock('@mantine/modals', () => ({ modals: { openConfirmModal: jest.fn() } }));
jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    settings: { getAiModels: { useQuery: jest.fn() } },
    useUtils: jest.fn(),
    aiDev: {
      listChatModels: { useQuery: jest.fn() },
      listConversations: { useQuery: jest.fn() },
      getConversation: { useQuery: jest.fn() },
      createConversation: { useMutation: jest.fn() },
      changeConversationModel: { useMutation: jest.fn() },
      deleteConversation: { useMutation: jest.fn() },
    },
  },
}));

import { useChat } from '@ai-sdk/react';
import { modals } from '@mantine/modals';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DefaultChatTransport } from 'ai';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { AiDevView, ConversationChat } from './AiDevView';

const id = '45f6af99-9a30-4638-b05f-fb826b970379';
const saved = {
  id,
  title: 'Saved title',
  selection: { provider: 'ollama', modelId: 'first:latest' },
  override: { provider: 'ollama', modelId: 'first:latest' },
  updatedAt: new Date('2026-10-17T12:00:00Z'),
  generating: false,
  messages: [],
  lastResponseStatus: null,
};
const sendMessage = jest.fn();
const regenerate = jest.fn();
const setMessages = jest.fn();
const stop = jest.fn().mockResolvedValue(undefined);
const refetch = jest.fn();
const create = jest.fn();
const remove = jest.fn();
const invalidate = jest.fn();
const query = {
  isPending: false,
  isFetching: false,
  isSuccess: true,
  isFetchedAfterMount: true,
  error: null,
  refetch,
};
const chat = {
  messages: [],
  status: 'ready',
  error: undefined,
  sendMessage,
  regenerate,
  setMessages,
  stop,
};

beforeAll(() => {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
  });
  HTMLElement.prototype.scrollTo = jest.fn();
  HTMLElement.prototype.hasPointerCapture = jest.fn();
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.releasePointerCapture = jest.fn();
});
beforeEach(() => {
  jest.clearAllMocks();
  (trpc.settings.getAiModels.useQuery as jest.Mock).mockReturnValue({
    isFetchedAfterMount: true,
    error: null,
    data: { settings: {}, resolved: {} },
  });
  (useChat as jest.Mock).mockReturnValue(chat);
  (trpc.useUtils as jest.Mock).mockReturnValue({
    aiDev: { listConversations: { invalidate }, getConversation: { invalidate } },
  });
  (trpc.aiDev.listChatModels.useQuery as jest.Mock).mockReturnValue({
    ...query,
    data: [{ provider: 'ollama', id: 'first:latest', capabilities: ['chat'] }],
  });
  (trpc.aiDev.listConversations.useQuery as jest.Mock).mockReturnValue({
    ...query,
    data: [{ id, title: 'Saved title', modelId: 'first:latest' }],
  });
  (trpc.aiDev.getConversation.useQuery as jest.Mock).mockReturnValue({ ...query, data: saved });
  (trpc.aiDev.changeConversationModel.useMutation as jest.Mock).mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
    error: null,
  });
  (trpc.aiDev.createConversation.useMutation as jest.Mock).mockReturnValue({
    mutate: create,
    isPending: false,
  });
  (trpc.aiDev.deleteConversation.useMutation as jest.Mock).mockReturnValue({
    mutate: remove,
    isPending: false,
  });
});
async function openSaved(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('combobox', { name: 'Saved conversations' }));
  await user.click(await screen.findByRole('option', { name: 'Saved title · first:latest' }));
}

describe('AiDevView saved conversations', () => {
  it('starts with the configured default and sends an inherited selection', async () => {
    (trpc.settings.getAiModels.useQuery as jest.Mock).mockReturnValue({
      isFetchedAfterMount: true,
      error: null,
      data: { resolved: { 'aiDev.chat': { selection: saved.selection, source: 'Default LLM' } } },
    });
    const user = userEvent.setup();
    render(<AiDevView />);
    expect(screen.getByRole('combobox', { name: 'Chat model' })).toHaveValue('Use settings');
    expect(screen.getByText('Using first:latest · Default LLM')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start conversation' }));
    expect(create).toHaveBeenCalledWith({ selection: null });
  });
  it('lets a saved conversation return to settings and locks the picker during generation', async () => {
    const mutate = jest.fn();
    (trpc.aiDev.changeConversationModel.useMutation as jest.Mock).mockReturnValue({ mutate });
    const user = userEvent.setup();
    const view = render(<AiDevView />);
    await openSaved(user);
    await user.click(screen.getByRole('combobox', { name: 'Chat model' }));
    await user.click(screen.getByRole('option', { name: 'Use settings' }));
    expect(mutate).toHaveBeenCalledWith({ id, selection: null });
    (useChat as jest.Mock).mockReturnValue({ ...chat, status: 'streaming' });
    view.rerender(
      <>
        <AiDevView />
      </>
    );
    expect(screen.getByRole('combobox', { name: 'Chat model' })).toBeDisabled();
  });
  it('creates a saved conversation with the chosen model before chatting', async () => {
    const user = userEvent.setup();
    render(<AiDevView />);
    expect(screen.getByRole('button', { name: 'Start conversation' })).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: 'Chat model' }));
    await user.click(await screen.findByRole('option', { name: 'first:latest' }));
    await user.click(screen.getByRole('button', { name: 'Start conversation' }));
    expect(create).toHaveBeenCalledWith({
      selection: { provider: 'ollama', modelId: 'first:latest' },
    });
  });
  it('opens saved history and allows changing its persisted model selection', async () => {
    const messages = [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Saved message' }] }];
    (trpc.aiDev.getConversation.useQuery as jest.Mock).mockReturnValue({
      ...query,
      data: { ...saved, messages },
    });
    (useChat as jest.Mock).mockReturnValue({ ...chat, messages });
    const user = userEvent.setup();
    render(<AiDevView />);
    await openSaved(user);
    expect(screen.getByText('Saved message')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Chat model' })).toBeEnabled();
    expect(useChat).toHaveBeenCalledWith(expect.objectContaining({ id, messages }));
  });
  it('sends only the latest user message for a saved conversation', async () => {
    const user = userEvent.setup();
    render(<AiDevView />);
    await openSaved(user);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hello{Enter}');
    expect(sendMessage).toHaveBeenCalledWith({ text: 'Hello' });
    const message = { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hello' }] };
    const transport = (DefaultChatTransport as jest.Mock).mock.calls[0][0];
    expect(
      transport.prepareSendMessagesRequest({
        id,
        messages: [message, { role: 'assistant', id: 'a' }],
      })
    ).toEqual({ body: { conversationId: id, message } });
  });
  it('keeps Shift+Enter as a line break', async () => {
    const user = userEvent.setup();
    render(<AiDevView />);
    await openSaved(user);
    await user.type(
      screen.getByRole('textbox', { name: 'Message' }),
      'First{Shift>}{Enter}{/Shift}Second'
    );
    expect(sendMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('First\nSecond');
  });
  it('stops the old chat when starting a new conversation', async () => {
    const user = userEvent.setup();
    render(<AiDevView />);
    await openSaved(user);
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(stop).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start conversation' })).toBeDisabled();
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
  });
  it('offers retry for a restored incomplete response', async () => {
    (trpc.aiDev.getConversation.useQuery as jest.Mock).mockReturnValue({
      ...query,
      data: { ...saved, lastResponseStatus: 'INTERRUPTED' },
    });
    const user = userEvent.setup();
    render(<AiDevView />);
    await openSaved(user);
    await user.click(screen.getByRole('button', { name: 'Retry response' }));
    expect(regenerate).toHaveBeenCalled();
  });
  it('disables sending while another generation is still active', async () => {
    (trpc.aiDev.getConversation.useQuery as jest.Mock).mockReturnValue({
      ...query,
      data: { ...saved, generating: true },
    });
    const user = userEvent.setup();
    render(<AiDevView />);
    await openSaved(user);
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    expect(screen.getByText(/A response is being generated/)).toBeInTheDocument();
  });
  it('requires confirmation before deleting a saved conversation', async () => {
    const user = userEvent.setup();
    render(<AiDevView />);
    await openSaved(user);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(remove).not.toHaveBeenCalled();
    (modals.openConfirmModal as jest.Mock).mock.calls[0][0].onConfirm();
    expect(remove).toHaveBeenCalledWith({ id });
  });
  it('does not display cached private data before a fresh authorized read', () => {
    (trpc.aiDev.listConversations.useQuery as jest.Mock).mockReturnValue({
      ...query,
      isFetchedAfterMount: false,
      data: [{ id, title: 'Other session title', modelId: 'first:latest' }],
    });
    render(<AiDevView />);
    expect(screen.getByRole('combobox', { name: 'Saved conversations' })).toBeDisabled();
    expect(screen.queryByText(/Other session title/)).not.toBeInTheDocument();
  });

  it('keeps cached private conversations hidden when the fresh read fails', () => {
    (trpc.aiDev.listConversations.useQuery as jest.Mock).mockReturnValue({
      ...query,
      error: new Error('Unauthorized'),
      data: [{ id, title: 'Other session title', modelId: 'first:latest' }],
    });
    render(<AiDevView />);
    expect(screen.getByRole('combobox', { name: 'Saved conversations' })).toBeDisabled();
    expect(screen.queryByText(/Other session title/)).not.toBeInTheDocument();
  });

  it('preserves a locally failed send when saved history refreshes', async () => {
    const user = userEvent.setup();
    const view = render(<AiDevView />);
    await openSaved(user);
    (useChat as jest.Mock).mockReturnValue({
      ...chat,
      error: new Error('A response is already being generated.'),
      status: 'error',
    });
    (trpc.aiDev.getConversation.useQuery as jest.Mock).mockReturnValue({
      ...query,
      data: { ...saved, updatedAt: new Date('2026-10-17T12:01:00Z') },
    });
    view.rerender(
      <>
        <AiDevView />
      </>
    );
    expect(setMessages).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry response' })).toBeEnabled();
  });
});

it('restores Planner history and sends the current workspace date after navigation', async () => {
  Object.assign(trpc, { plannerChat: trpc.aiDev });
  (trpc.useUtils as jest.Mock).mockReturnValue({
    plannerChat: { listConversations: { invalidate }, getConversation: { invalidate } },
  });
  const view = render(<ConversationChat plannerDate="2026-10-24" />);
  expect(await screen.findByRole('textbox', { name: 'Message' })).toBeInTheDocument();
  const transport = (DefaultChatTransport as jest.Mock).mock.calls.at(-1)[0];
  expect(transport.api).toBe('/api/planner/chat');
  const message = { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Help plan' }] };
  expect(transport.prepareSendMessagesRequest({ id, messages: [message] }).body.date).toBe(
    '2026-10-24'
  );
  view.rerender(
    <>
      <ConversationChat plannerDate="2026-10-25" />
    </>
  );
  expect(transport.prepareSendMessagesRequest({ id, messages: [message] }).body).toEqual({
    conversationId: id,
    message,
    date: '2026-10-25',
    focusedBlockId: null,
    focusedTaskId: null,
    proposalId: null,
  });
});

it('restores saved per-response Planner diagnostics behind a collapsed inspector', async () => {
  const user = userEvent.setup();
  Object.assign(trpc, { plannerChat: trpc.aiDev });
  (trpc.useUtils as jest.Mock).mockReturnValue({
    plannerChat: { listConversations: { invalidate }, getConversation: { invalidate } },
  });
  (useChat as jest.Mock).mockReturnValue({
    ...chat,
    messages: [
      {
        id: 'a',
        role: 'assistant',
        parts: [
          {
            type: 'data-plannerDebug',
            data: {
              omittedEvents: 0,
              events: [
                {
                  id: '1',
                  at: '2026-10-24T10:00:00Z',
                  elapsedMs: 100,
                  kind: 'tool-error',
                  label: 'Tool failed',
                  details: 'Scheduler unavailable',
                },
              ],
            },
          },
        ],
      },
    ],
  });
  render(<ConversationChat plannerDate="2026-10-24" />);
  const toggle = await screen.findByRole('button', { name: 'Planner debug · 1 events' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('Scheduler unavailable')).toBeInTheDocument();
});
