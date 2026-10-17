/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/ai', () => ({ discoverModels: jest.fn(), resolveChatModel: jest.fn() }));
jest.mock('./conversations', () => ({
  conversationService: { beginTurn: jest.fn(), finishTurn: jest.fn() },
}));
jest.mock('ai', () => ({
  convertToModelMessages: jest.fn(),
  streamText: jest.fn(),
  toUIMessageStream: jest.fn(),
  createUIMessageStream: jest.fn(),
  createUIMessageStreamResponse: jest.fn(),
}));

import { convertToModelMessages, createUIMessageStream, streamText, toUIMessageStream } from 'ai';
import { discoverModels, resolveChatModel } from '@/lib/ai';
import { conversationService } from './conversations';
import { aiDevService } from './service';
import type { ChatInput } from './schema';

const input: ChatInput = {
  conversationId: '45f6af99-9a30-4638-b05f-fb826b970379',
  message: { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
};
const reply = { id: 'a', role: 'assistant', parts: [] };
const turn = {
  selection: { provider: 'ollama', modelId: 'saved:latest' },
  history: [input.message],
  response: reply,
  generationId: 'generation-1',
};
const signal = new AbortController().signal;

beforeEach(() => {
  jest.resetAllMocks();
  (conversationService.beginTurn as jest.Mock).mockResolvedValue(turn);
  (streamText as jest.Mock).mockReturnValue({ stream: new ReadableStream() });
});

describe('aiDevService', () => {
  it('lists only chat-capable models', async () => {
    const chat = { id: 'chat', capabilities: ['chat'] };
    (discoverModels as jest.Mock).mockResolvedValue([
      chat,
      { id: 'embedding', capabilities: ['embedding'] },
    ]);
    await expect(aiDevService.listChatModels()).resolves.toEqual([chat]);
  });
  it('uses owner-scoped saved history, saved model selection and a stable response ID', async () => {
    await aiDevService.streamChat('user-a', input, signal);
    expect(conversationService.beginTurn).toHaveBeenCalledWith('user-a', input);
    expect(resolveChatModel).toHaveBeenCalledWith(turn.selection);
    expect(convertToModelMessages).toHaveBeenCalledWith(turn.history);
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: signal, timeout: 120_000, maxRetries: 0 })
    );
    const options = (toUIMessageStream as jest.Mock).mock.calls[0][0];
    expect(options.generateMessageId()).toBe('a');
    expect(options.onError(new Error('private'))).not.toContain('private');
  });
  it.each([
    { outcome: { status: 'completed' }, isAborted: false, expected: 'COMPLETED' },
    { outcome: { status: 'failed' }, isAborted: false, expected: 'FAILED' },
    { outcome: { status: 'aborted' }, isAborted: true, expected: 'INTERRUPTED' },
    { outcome: { status: 'unknown' }, isCancelled: true, expected: 'INTERRUPTED' },
  ])('persists the stream outcome $expected', async (event) => {
    await aiDevService.streamChat('user-a', input, signal);
    const responseMessage = { ...reply, parts: [{ type: 'text', text: 'Saved text' }] };
    await (toUIMessageStream as jest.Mock).mock.calls[0][0].onEnd({ ...event, responseMessage });
    expect(conversationService.finishTurn).toHaveBeenCalledWith(
      'user-a',
      input.conversationId,
      'generation-1',
      responseMessage,
      event.expected
    );
  });
  it('marks setup failures without duplicating the saved user message', async () => {
    (resolveChatModel as jest.Mock).mockRejectedValue(new Error('offline'));
    await expect(aiDevService.streamChat('user-a', input, signal)).rejects.toThrow('offline');
    expect(conversationService.finishTurn).toHaveBeenCalledWith(
      'user-a',
      input.conversationId,
      'generation-1',
      reply,
      'FAILED'
    );
  });
  it('replays a completed response without invoking the model again', async () => {
    (conversationService.beginTurn as jest.Mock).mockResolvedValue({
      ...turn,
      generationId: null,
      response: { ...reply, parts: [{ type: 'text', text: 'Existing' }] },
    });
    await aiDevService.streamChat('user-a', input, signal);
    const writer = { write: jest.fn() };
    (createUIMessageStream as jest.Mock).mock.calls[0][0].execute({ writer });
    expect(writer.write).toHaveBeenCalledWith({ type: 'start', messageId: 'a' });
    expect(resolveChatModel).not.toHaveBeenCalled();
    expect(conversationService.finishTurn).not.toHaveBeenCalled();
  });
  it('surfaces persistence failure without exposing database details', async () => {
    await aiDevService.streamChat('user-a', input, signal);
    (conversationService.finishTurn as jest.Mock).mockRejectedValue(new Error('private SQL'));
    await expect(
      (toUIMessageStream as jest.Mock).mock.calls[0][0].onEnd({
        responseMessage: reply,
        outcome: { status: 'completed' },
      })
    ).rejects.toThrow('The response could not be saved.');
  });
});
