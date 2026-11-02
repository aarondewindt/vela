import 'server-only';
import { TRPCError } from '@trpc/server';

import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type ToolSet,
  type UIMessage,
  type ModelMessage,
  toUIMessageStream,
} from 'ai';
import { streamPlanningTurn } from '@/lib/planner/chat/streaming';
import {
  discoverModels,
  resolveChatModel,
  validateModelSelection,
  type AiModelSelection,
} from '@/lib/ai';
import { reconstructModelMessages } from './multimodal';
import { conversationService } from './conversations';
import type { ChatInput, StageSelections } from './schema';

type ConversationStore = typeof conversationService;
export function createChatService(store: ConversationStore = conversationService) {
  return {
    /** Shared persisted non-streaming turn lifecycle, including authoritative images and retry replay. */
    async completeTurn(
      userId: string,
      input: ChatInput,
      signal: AbortSignal,
      generate: (context: {
        messages: ModelMessage[];
        selection: AiModelSelection;
        stageSelections?: StageSelections;
        history: UIMessage[];
        checkpoint: unknown;
        saveCheckpoint: (value: unknown) => Promise<void>;
        signal: AbortSignal;
      }) => Promise<UIMessage['parts']>
    ) {
      const turn = await store.beginTurn(userId, input);
      if (turn.generationId === null) {
        return turn.response;
      }
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(540_000)]);
      try {
        if (
          !turn.history.some((message) =>
            message.parts.some((part) => part.type === 'data-attachment')
          )
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Attach photographs before extracting.',
          });
        }
        // Staged pipelines own validation and diagnostics for the stages they actually execute.
        // In particular, cached transcription can be reused without validating an unused vision model.
        if (!turn.stageSelections) {
          await validateModelSelection(turn.selection, ['chat', 'vision'], deadline);
        }
        const messages = await reconstructModelMessages(userId, turn.history);
        deadline.throwIfAborted();
        const response = {
          ...turn.response,
          parts: await generate({
            messages,
            selection: turn.selection,
            stageSelections: turn.stageSelections,
            history: turn.history,
            checkpoint: turn.checkpoint,
            saveCheckpoint: async (value) => {
              // Bounded persistence may finish after inference cancellation so failures remain reviewable.
              await store.saveCheckpoint(
                userId,
                input.conversationId,
                turn.generationId!,
                turn.response.id,
                value
              );
            },
            signal: deadline,
          }),
        };
        deadline.throwIfAborted();
        await store.finishTurn(
          userId,
          input.conversationId,
          turn.generationId,
          response,
          'COMPLETED'
        );
        return response;
      } catch (error) {
        await store.finishTurn(
          userId,
          input.conversationId,
          turn.generationId,
          turn.response,
          signal.aborted ? 'INTERRUPTED' : 'FAILED'
        );
        throw error;
      }
    },

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
                if (
                  part.type === 'data-planning' ||
                  part.type === 'data-plannerDebug' ||
                  part.type === 'data-productSuggestion'
                ) {
                  writer.write(part);
                }
              }
              writer.write({ type: 'finish', finishReason: 'stop' });
            },
          }),
        });
      }
      if (tools) {
        return streamPlanningTurn({ store, userId, input, signal, system, tools, turn });
      }
      const generationId = turn.generationId;
      try {
        if (
          turn.history.some((message) =>
            message.parts.some((part) => part.type === 'data-attachment')
          )
        ) {
          await validateModelSelection(turn.selection, ['chat', 'vision']);
        }
        const model = await resolveChatModel(turn.selection);
        const messages = await reconstructModelMessages(userId, turn.history);
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
