import 'server-only';
import { generateText, Output, type ModelMessage } from 'ai';
import type { z } from 'zod';
import { resolveChatModel, type AiModelSelection } from './ollama';
import { AiError } from './errors';
import { diagnosticErrors, diagnosticText, type GenerationDiagnostics } from './diagnostics';

/** Shared bounded, schema-validated generation. Domain interpretation belongs to the caller. */
export async function generateStructured<T>({
  selection,
  schema,
  system,
  prompt,
  messages,
  signal,
  onDiagnostics,
  timeoutMs = 120_000,
  maxOutputTokens = 4096,
}: {
  selection: AiModelSelection;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  messages?: ModelMessage[];
  signal?: AbortSignal;
  onDiagnostics?: (details: GenerationDiagnostics) => void;
  timeoutMs?: number;
  maxOutputTokens?: number;
}): Promise<T> {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 480_000 ||
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 1 ||
    maxOutputTokens > 32_768
  ) {
    throw new AiError('CONFIGURATION_ERROR', 'The structured-generation budget is invalid.');
  }
  const deadline = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  const started = Date.now();
  const details: GenerationDiagnostics = {
    ...selection,
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    maxOutputTokens,
    timeoutMs,
  };
  try {
    const contextLength = messages
      ? messages.reduce(
          (total, message) =>
            total +
            (typeof message.content === 'string'
              ? message.content.length
              : message.content.reduce(
                  (sum, part) => sum + (part.type === 'text' ? part.text.length : 0),
                  0
                )),
          0
        )
      : prompt.length;
    if ((!prompt.trim() && !messages?.length) || system.length + contextLength > 64_000) {
      throw new AiError(
        'INVALID_PROVIDER_RESPONSE',
        'The structured-generation context is empty or too large.'
      );
    }
    const model =
      timeoutMs === 120_000
        ? await resolveChatModel(selection, deadline)
        : await resolveChatModel(selection, deadline, timeoutMs);
    const result = await generateText({
      model,
      system,
      ...(messages ? { messages } : { prompt }),
      output: Output.object({ schema }),
      maxOutputTokens,
      maxRetries: 0,
      temperature: 0,
      providerOptions: { ollama: { think: false } },
      timeout: timeoutMs,
      abortSignal: deadline,
    });
    details.rawResponse = diagnosticText(result.text ?? '');
    details.finishReason = result.finishReason;
    return schema.parse(result.output);
  } catch (error) {
    details.aborted = deadline.aborted;
    details.errors = diagnosticErrors(error);
    if (deadline.aborted) {
      details.errors.push(...diagnosticErrors(deadline.reason));
    }
    // Structured-output SDK errors retain the generated text and validation cause.
    if (error instanceof Error && 'text' in error && typeof error.text === 'string') {
      details.rawResponse = diagnosticText(error.text);
    }
    if (
      error instanceof Error &&
      'finishReason' in error &&
      typeof error.finishReason === 'string'
    ) {
      details.finishReason = error.finishReason;
    }
    if (error instanceof AiError) {
      throw error;
    }
    throw new AiError(
      'INVALID_PROVIDER_RESPONSE',
      'The model did not return a valid structured response. Your saved work is preserved; check the model and retry.'
    );
  } finally {
    details.durationMs = Date.now() - started;
    onDiagnostics?.(details);
  }
}
