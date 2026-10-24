import 'server-only';

import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
} from 'ai';
import { discoverModels, resolveChatModel } from '@/lib/ai';
import { conversationService } from './conversations';
import type { ChatInput } from './schema';

type ConversationStore = typeof conversationService;
export function createChatService(store: ConversationStore = conversationService) {
  return {
    async listChatModels() {
      const models = await discoverModels();
      return models.filter((model) => model.capabilities.includes('chat'));
    },

    async streamChat(userId: string, input: ChatInput, signal: AbortSignal, system?: string) {
      const turn = await store.beginTurn(userId, input);
      if (turn.generationId === null) {
        return createUIMessageStreamResponse({
          headers: { 'Cache-Control': 'private, no-store' },
          stream: createUIMessageStream({
            execute: ({ writer }) => {
              writer.write({ type: 'start', messageId: turn.response.id });
              writer.write({ type: 'text-start', id: 'saved-text' });
              writer.write({
                type: 'text-delta',
                id: 'saved-text',
                delta: turn.response.parts
                  .map((part) => (part.type === 'text' ? part.text : ''))
                  .join(''),
              });
              writer.write({ type: 'text-end', id: 'saved-text' });
              writer.write({ type: 'finish', finishReason: 'stop' });
            },
          }),
        });
      }
      const generationId = turn.generationId;
      try {
        const model = await resolveChatModel(turn.selection);
        const messages = await convertToModelMessages(turn.history);
        const result = streamText({
          model,
          system,
          messages,
          abortSignal: signal,
          timeout: 120_000,
          maxOutputTokens: 2048,
          maxRetries: 0,
          // Errors reach the UI stream; avoid SDK logging of provider payloads.
          onError: () => undefined,
        });
        return createUIMessageStreamResponse({
          headers: { 'Cache-Control': 'private, no-store' },
          stream: toUIMessageStream({
            stream: result.stream,
            originalMessages: turn.history,
            generateMessageId: () => turn.response.id,
            sendReasoning: false,
            sendSources: false,
            onError: () => 'The AI response was interrupted. Check Ollama and try again.',
            onEnd: async ({ responseMessage, outcome, isAborted, isCancelled }) => {
              const interrupted = isAborted || isCancelled || signal.aborted;
              const hasText = responseMessage.parts.some(
                (part) => part.type === 'text' && part.text.trim().length > 0
              );
              const status = interrupted
                ? 'INTERRUPTED'
                : outcome.status === 'completed' && hasText
                  ? 'COMPLETED'
                  : 'FAILED';
              try {
                await store.finishTurn(
                  userId,
                  input.conversationId,
                  generationId,
                  responseMessage,
                  status
                );
              } catch {
                throw new Error(
                  'The response could not be saved. Reload the conversation before retrying.'
                );
              }
            },
          }),
        });
      } catch (error) {
        await store.finishTurn(
          userId,
          input.conversationId,
          generationId,
          turn.response,
          signal.aborted ? 'INTERRUPTED' : 'FAILED'
        );
        throw error;
      }
    },
  };
}
export const aiDevService = createChatService();
