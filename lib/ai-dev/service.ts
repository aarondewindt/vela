import 'server-only';

import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
} from 'ai';
import { discoverModels, resolveChatModel } from '@/lib/ai';
import type { ChatInput } from './schema';

export const aiDevService = {
  async listChatModels() {
    const models = await discoverModels();
    return models.filter((model) => model.capabilities.includes('chat'));
  },

  async streamChat(input: ChatInput, signal: AbortSignal) {
    const model = await resolveChatModel(input.selection);
    // A stopped response can contain only a step-start part. Keep meaningful history.
    const history = input.messages.filter((message) =>
      message.parts.some((part) => part.type === 'text' && part.text.trim().length > 0)
    );
    const messages = await convertToModelMessages(history);
    const result = streamText({
      model,
      messages,
      abortSignal: signal,
      timeout: 120_000,
      maxOutputTokens: 2048,
      maxRetries: 0,
      // Report errors through the UI stream below instead of SDK payload logging.
      onError: () => undefined,
    });

    return createUIMessageStreamResponse({
      headers: { 'Cache-Control': 'private, no-store' },
      stream: toUIMessageStream({
        stream: result.stream,
        sendReasoning: false,
        sendSources: false,
        onError: () => 'The AI response was interrupted. Check Ollama and try again.',
      }),
    });
  },
};
