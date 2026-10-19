import 'server-only';
import { generateText, Output } from 'ai';
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
  signal,
  onDiagnostics,
}: {
  selection: AiModelSelection;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  signal?: AbortSignal;
  onDiagnostics?: (details: GenerationDiagnostics) => void;
}): Promise<T> {
  const deadline = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    : AbortSignal.timeout(120_000);
  const started = Date.now();
  const details: GenerationDiagnostics = {
    ...selection,
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    maxOutputTokens: 4096,
    timeoutMs: 120_000,
  };
  try {
    if (!prompt.trim() || system.length + prompt.length > 64_000) {
      throw new AiError(
        'INVALID_PROVIDER_RESPONSE',
        'The structured-generation context is empty or too large.'
      );
    }
    const model = await resolveChatModel(selection, deadline);
    const result = await generateText({
      model,
      system,
      prompt,
      output: Output.object({ schema }),
      maxOutputTokens: 4096,
      maxRetries: 0,
      temperature: 0,
      providerOptions: { ollama: { think: false } },
      timeout: 120_000,
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
