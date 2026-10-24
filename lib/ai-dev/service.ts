import 'server-only';

import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  stepCountIs,
  type ToolSet,
  type UIMessage,
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

    async streamChat(
      userId: string,
      input: ChatInput,
      signal: AbortSignal,
      system?: string,
      tools?: ToolSet
    ) {
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
              for (const part of turn.response.parts) {
                if (part.type === 'data-planning') {
                  writer.write(part);
                }
              }
              writer.write({ type: 'finish', finishReason: 'stop' });
            },
          }),
        });
      }
      const generationId = turn.generationId;
      try {
        const model = await resolveChatModel(turn.selection);
        const history = tools
          ? turn.history
              .slice(-12)
              .map((message) => ({
                ...message,
                parts: [
                  {
                    type: 'text' as const,
                    text: message.parts
                      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
                      .join('\n')
                      .slice(0, 2000),
                  },
                ],
              }))
              .filter((message) =>
                message.parts.some((part) => part.type === 'text' && part.text.trim())
              )
          : turn.history;
        const messages = await convertToModelMessages(history);
        const result = streamText({
          model,
          system,
          tools,
          ...(tools ? { stopWhen: stepCountIs(4) } : {}),
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
              let savedMessage = responseMessage;
              // Persist compact application results, not provider-specific tool transcripts.
              if (tools) {
                savedMessage = {
                  ...savedMessage,
                  parts: savedMessage.parts.flatMap((part) => {
                    if (
                      part.type.startsWith('tool-') &&
                      'output' in part &&
                      part.output &&
                      typeof part.output === 'object' &&
                      'date' in part.output &&
                      'reply' in part.output
                    ) {
                      return [
                        { type: 'data-planning', data: part.output } as UIMessage['parts'][number],
                      ];
                    }
                    return part.type.startsWith('tool-') ? [] : [part];
                  }),
                };
              }
              const interrupted = isAborted || isCancelled || signal.aborted;
              const hasText = savedMessage.parts.some(
                (part) =>
                  (part.type === 'text' && part.text.trim().length > 0) ||
                  part.type === 'data-planning'
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
                  savedMessage,
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
