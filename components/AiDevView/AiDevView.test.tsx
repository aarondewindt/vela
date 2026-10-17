jest.mock('@ai-sdk/react', () => ({ useChat: jest.fn() }));
jest.mock('ai', () => ({ DefaultChatTransport: jest.fn() }));
jest.mock('@/lib/trpc/client', () => ({
  trpc: { aiDev: { listChatModels: { useQuery: jest.fn() } } },
}));

import { useChat } from '@ai-sdk/react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { AiDevView } from './AiDevView';

const sendMessage = jest.fn();
const regenerate = jest.fn();
const stop = jest.fn().mockResolvedValue(undefined);
const refetch = jest.fn();
const query = {
  data: [
    { provider: 'ollama', id: 'first:latest', capabilities: ['chat'] },
    { provider: 'ollama', id: 'second:latest', capabilities: ['chat'] },
  ],
  isPending: false,
  isFetching: false,
  isSuccess: true,
  error: null,
  refetch,
};
const chat = { messages: [], status: 'ready', error: undefined, sendMessage, regenerate, stop };

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
  (useChat as jest.Mock).mockReturnValue(chat);
  (trpc.aiDev.listChatModels.useQuery as jest.Mock).mockReturnValue(query);
});

async function chooseModel(user: ReturnType<typeof userEvent.setup>, name = 'first:latest') {
  await user.click(screen.getByRole('combobox', { name: 'Chat model' }));
  await user.click(await screen.findByRole('option', { name }));
}

describe('AiDevView', () => {
  it('requires a model and a message before sending', async () => {
    const user = userEvent.setup();
    render(<AiDevView />);
    expect(screen.getByText('Start a conversation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    await chooseModel(user);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(sendMessage).toHaveBeenCalledWith(
      { text: 'Hello' },
      { body: { selection: { provider: 'ollama', modelId: 'first:latest' } } }
    );
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  });

  it('uses the current model selection on each request', async () => {
    const user = userEvent.setup();
    render(<AiDevView />);
    await chooseModel(user);
    await chooseModel(user, 'second:latest');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hello{Enter}');
    expect(sendMessage).toHaveBeenCalledWith(
      { text: 'Hello' },
      { body: { selection: { provider: 'ollama', modelId: 'second:latest' } } }
    );
  });

  it('keeps Shift+Enter as a line break', async () => {
    const user = userEvent.setup();
    render(<AiDevView />);
    await chooseModel(user);
    await user.type(
      screen.getByRole('textbox', { name: 'Message' }),
      'First{Shift>}{Enter}{/Shift}Second'
    );
    expect(sendMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('First\nSecond');
  });

  it('cancels the active stream and clears the draft on a new conversation', async () => {
    const user = userEvent.setup();
    render(<AiDevView />);
    await chooseModel(user);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Draft');
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(stop).toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Chat model' })).toHaveValue('first:latest');
  });

  it('renders streamed messages and offers cancellation while busy', async () => {
    (useChat as jest.Mock).mockReturnValue({
      ...chat,
      status: 'streaming',
      messages: [
        { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
        { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'A streamed reply' }] },
      ],
    });
    const user = userEvent.setup();
    render(<AiDevView />);
    expect(screen.getByRole('article', { name: 'Assistant message' })).toHaveTextContent(
      'A streamed reply'
    );
    expect(screen.getByRole('combobox', { name: 'Chat model' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Stop response' }));
    expect(stop).toHaveBeenCalled();
  });

  it('retries a failed response with the selected model', async () => {
    const user = userEvent.setup();
    const view = render(<AiDevView />);
    await chooseModel(user);
    (useChat as jest.Mock).mockReturnValue({
      ...chat,
      status: 'error',
      error: new Error('Ollama is unavailable.'),
    });
    view.rerender(
      <>
        <AiDevView />
      </>
    );
    expect(screen.getByText('Ollama is unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry response' }));
    expect(regenerate).toHaveBeenCalledWith({
      body: { selection: { provider: 'ollama', modelId: 'first:latest' } },
    });
  });

  it('shows provider discovery errors with a retry action', async () => {
    (trpc.aiDev.listChatModels.useQuery as jest.Mock).mockReturnValue({
      ...query,
      isSuccess: false,
      error: new Error('Set OLLAMA_BASE_URL to enable Ollama.'),
    });
    const user = userEvent.setup();
    render(<AiDevView />);
    expect(screen.getByText('Set OLLAMA_BASE_URL to enable Ollama.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry loading models' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('shows when no chat-capable models are available', () => {
    (trpc.aiDev.listChatModels.useQuery as jest.Mock).mockReturnValue({ ...query, data: [] });
    render(<AiDevView />);
    expect(screen.getByText(/No chat models are installed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
