import 'server-only';
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type ToolSet,
  type UIMessage,
} from 'ai';
import { resolveChatModel } from '@/lib/ai';
import type { conversationService, ResponseStatus } from '@/lib/ai-dev/conversations';
import type { ChatInput } from '@/lib/ai-dev/schema';
import { diagnosticErrors } from '@/lib/ai/diagnostics';
import { createPlannerTrace, debugText, observeToolChunk } from './debug';

export async function streamPlanningTurn({
  store,
  userId,
  input,
  signal,
  system,
  tools,
  turn,
  resolveModel = resolveChatModel,
}: {
  store: typeof conversationService;
  userId: string;
  input: ChatInput;
  signal: AbortSignal;
  system?: string;
  tools: ToolSet;
  turn: Awaited<ReturnType<typeof conversationService.beginTurn>>;
  resolveModel?: typeof resolveChatModel;
}) {
  const generationId = turn.generationId!;
  const trace = createPlannerTrace();
  const history = turn.history
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
    .filter((message) => message.parts[0].text.trim());
  trace.record('request', 'Planner model request', {
    model: turn.selection,
    tools: Object.keys(tools),
    maxOutputTokens: 4096,
    timeoutMs: 150000,
    thinking: false,
    latestMessage: input.message,
    historyMessages: history.length,
    system,
    messages: history,
  });
  let status: ResponseStatus = 'FAILED';
  const stream = createUIMessageStream({
    originalMessages: turn.history,
    generateId: () => turn.response.id,
    onError: () => 'Planner response processing failed. Reload to inspect saved debug details.',
    execute: async ({ writer }) => {
      const debug = () =>
        writer.write({ type: 'data-plannerDebug', id: 'planner-debug', data: trace.snapshot() });
      const text = (message: string) => {
        writer.write({ type: 'text-start', id: 'planner-status' });
        writer.write({ type: 'text-delta', id: 'planner-status', delta: message });
        writer.write({ type: 'text-end', id: 'planner-status' });
      };
      writer.write({ type: 'start', messageId: turn.response.id });
      debug();
      let finishReason: string | undefined;
      let modelOutcome = 'unknown';
      let hasText = false;
      let hasProposal = false;
      let errorMessage: string | undefined;
      try {
        const model = await resolveModel(turn.selection);
        const result = streamText({
          model,
          system,
          tools,
          messages: await convertToModelMessages(history),
          stopWhen: stepCountIs(4),
          toolCallConcurrency: 1,
          abortSignal: signal,
          timeout: 150000,
          maxOutputTokens: 4096,
          maxRetries: 0,
          providerOptions: { ollama: { think: false } },
          onError: ({ error }) => {
            const errors = diagnosticErrors(error);
            errorMessage = debugText(errors[0]?.message ?? 'The model/provider request failed.');
            trace.record('error', 'Model/provider error', { errors });
            debug();
          },
          onStepEnd: (step) => {
            finishReason = step.finishReason;
            trace.record('model-step', `Model step finished: ${step.finishReason}`, {
              finishReason: step.finishReason,
              usage: {
                inputTokens: step.usage.inputTokens,
                outputTokens: step.usage.outputTokens,
                reasoningTokens: step.usage.outputTokenDetails.reasoningTokens,
              },
            });
            debug();
          },
        });
        const reader = toUIMessageStream({
          stream: result.stream,
          sendStart: false,
          sendFinish: false,
          sendReasoning: false,
          sendSources: false,
          onError: (error) =>
            debugText(
              diagnosticErrors(error)
                .map((item) => `${item.name}: ${item.message}`)
                .join('\n') ||
                errorMessage ||
                'The model response was interrupted.'
            ).slice(0, 6000),
          onEnd: (event) => {
            modelOutcome = event.outcome.status;
            finishReason = event.finishReason ?? finishReason;
          },
        }).getReader();
        try {
          while (true) {
            const { value: chunk, done } = await reader.read();
            if (done) {
              break;
            }
            observeToolChunk(trace, chunk);
            if (chunk.type === 'error') {
              errorMessage = chunk.errorText;
              trace.record('error', 'Response stream error', { error: chunk.errorText });
              debug();
              continue;
            }
            if (chunk.type === 'text-delta' && chunk.delta.trim()) {
              hasText = true;
            }
            if (
              chunk.type === 'tool-output-available' &&
              chunk.output &&
              typeof chunk.output === 'object' &&
              'date' in chunk.output &&
              'reply' in chunk.output
            ) {
              hasProposal = true;
            }
            writer.write(chunk);
            if (chunk.type.startsWith('tool-')) {
              debug();
            }
          }
        } finally {
          reader.releaseLock();
        }
        const interrupted = signal.aborted || modelOutcome === 'aborted';
        status = interrupted
          ? 'INTERRUPTED'
          : modelOutcome === 'completed' && (hasText || hasProposal)
            ? 'COMPLETED'
            : 'FAILED';
        if (!hasText && !hasProposal) {
          const toolError = trace
            .snapshot()
            .events.findLast((event) => event.kind === 'tool-error');
          const reason = interrupted
            ? 'The request was cancelled or timed out.'
            : errorMessage
              ? `The model/provider failed: ${errorMessage}`
              : finishReason === 'length'
                ? 'The model reached its output-token limit before producing a reply or proposal.'
                : toolError
                  ? 'A planning tool failed and the model did not produce a reply.'
                  : `The model ended without a reply or planning proposal (finish reason: ${finishReason ?? 'unknown'}).`;
          text(
            `${reason} Open Planner debug below for details, then retry. Your saved schedule was not changed by chat.`
          );
        }
      } catch (error) {
        status = signal.aborted ? 'INTERRUPTED' : 'FAILED';
        const errors = diagnosticErrors(error);
        trace.record('error', 'Planner generation failed', { errors });
        text(
          `Planner could not finish: ${debugText(errors[0]?.message ?? 'Unknown generation error')}. Open Planner debug for details. Your saved schedule was not changed by chat.`
        );
      }
      trace.record('finish', `Planner response: ${status}`, { status, finishReason, modelOutcome });
      debug();
      writer.setOutcome({
        status:
          status === 'COMPLETED' ? 'completed' : status === 'INTERRUPTED' ? 'aborted' : 'failed',
      });
      writer.write({ type: 'finish', finishReason: status === 'COMPLETED' ? 'stop' : 'error' });
    },
    onEnd: async ({ responseMessage, isCancelled, isAborted }) => {
      const parts: UIMessage['parts'] = responseMessage.parts.flatMap((part) => {
        if (part.type === 'data-plannerDebug') {
          return [];
        }
        if (part.type.startsWith('tool-')) {
          if (
            'output' in part &&
            part.output &&
            typeof part.output === 'object' &&
            'date' in part.output &&
            'reply' in part.output
          ) {
            return [{ type: 'data-planning', data: part.output } as UIMessage['parts'][number]];
          }
          return [];
        }
        return [part];
      });
      if (isCancelled || isAborted || signal.aborted) {
        status = 'INTERRUPTED';
        trace.record('finish', 'Planner response interrupted', {
          cancelled: Boolean(isCancelled),
          aborted: Boolean(isAborted || signal.aborted),
        });
      }
      parts.push({ type: 'data-plannerDebug', data: trace.snapshot() });
      try {
        await store.finishTurn(
          userId,
          input.conversationId,
          generationId,
          { ...responseMessage, parts },
          status
        );
      } catch {
        throw new Error(
          'The response could not be saved. Reload the conversation before retrying.'
        );
      }
    },
  });
  return createUIMessageStreamResponse({
    headers: { 'Cache-Control': 'private, no-store' },
    stream,
  });
}
