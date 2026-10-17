/** @jest-environment node */

jest.mock('server-only', () => ({}));
jest.mock('@/lib/ai', () => ({ discoverModels: jest.fn(), resolveChatModel: jest.fn() }));
jest.mock('ai', () => ({
  convertToModelMessages: jest.fn(),
  streamText: jest.fn(),
  toUIMessageStream: jest.fn(),
  createUIMessageStreamResponse: jest.fn(),
}));

import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
} from 'ai';
import { discoverModels, resolveChatModel } from '@/lib/ai';
import { aiDevService } from './service';
import type { ChatInput } from './schema';

const input: ChatInput = {
  selection: { provider: 'ollama', modelId: 'chat:latest' },
  messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe('aiDevService', () => {
  it('lists chat-capable models without exposing embedding-only models', async () => {
    const chat = { provider: 'ollama', id: 'chat:latest', capabilities: ['chat'] };
    (discoverModels as jest.Mock).mockResolvedValue([
      chat,
      { provider: 'ollama', id: 'vectors:latest', capabilities: ['embedding'] },
    ]);
    await expect(aiDevService.listChatModels()).resolves.toEqual([chat]);
  });

  it('streams validated history with bounded generation and safe error messages', async () => {
    const model = { modelId: 'chat:latest' };
    const stream = new ReadableStream();
    const uiStream = new ReadableStream();
    const response = new Response();
    const messages = [{ role: 'user', content: 'Hello' }];
    (resolveChatModel as jest.Mock).mockResolvedValue(model);
    (convertToModelMessages as jest.Mock).mockResolvedValue(messages);
    (streamText as jest.Mock).mockReturnValue({ stream });
    (toUIMessageStream as jest.Mock).mockReturnValue(uiStream);
    (createUIMessageStreamResponse as jest.Mock).mockReturnValue(response);
    const controller = new AbortController();

    await expect(aiDevService.streamChat(input, controller.signal)).resolves.toBe(response);
    expect(resolveChatModel).toHaveBeenCalledWith(input.selection);
    expect(convertToModelMessages).toHaveBeenCalledWith(input.messages);
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        messages,
        abortSignal: controller.signal,
        timeout: 120_000,
        maxOutputTokens: 2048,
        maxRetries: 0,
      })
    );
    expect(createUIMessageStreamResponse).toHaveBeenCalledWith({
      stream: uiStream,
      headers: { 'Cache-Control': 'private, no-store' },
    });
    const options = (toUIMessageStream as jest.Mock).mock.calls[0][0];
    expect(options).toMatchObject({ stream, sendReasoning: false, sendSources: false });
    expect(options.onError(new Error('private prompt'))).not.toContain('private');
  });

  it('omits an empty assistant response left by cancellation', async () => {
    (streamText as jest.Mock).mockReturnValue({ stream: new ReadableStream() });
    await aiDevService.streamChat(
      {
        ...input,
        messages: [
          input.messages[0],
          { id: 'a', role: 'assistant', parts: [{ type: 'step-start' }] },
          { ...input.messages[0], id: 'u2' },
        ],
      },
      new AbortController().signal
    );
    expect(convertToModelMessages).toHaveBeenCalledWith([
      input.messages[0],
      { ...input.messages[0], id: 'u2' },
    ]);
  });
});
