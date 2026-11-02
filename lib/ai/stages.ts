import 'server-only';
import type { ModelMessage } from 'ai';
import type { z } from 'zod';
import { AiError } from './errors';
import { generateStructured } from './structured';
import { validateModelSelection } from './ollama';
import type { AiModelCapability, AiModelSelection } from './capabilities';
import type { GenerationDiagnostics } from './diagnostics';

export type StageDiagnostics = {
  stage: string;
  selection: AiModelSelection;
  promptVersion: string;
  schemaVersion: string;
  startedAt: string;
  durationMs: number;
  timeoutMs: number;
  maxOutputTokens: number;
  attempts: number;
  status: 'completed' | 'failed' | 'cancelled' | 'timedOut';
  errorCode?: string;
  reused?: boolean;
};

export class AiStageError extends AiError {
  constructor(
    public readonly stage: string,
    label: string,
    error: unknown,
    public readonly diagnostics: StageDiagnostics
  ) {
    super(
      error instanceof AiError ? error.code : 'INVALID_PROVIDER_RESPONSE',
      `${label} failed: ${diagnostics.status === 'timedOut' ? 'the stage exceeded its time limit.' : diagnostics.status === 'cancelled' ? 'generation was cancelled.' : error instanceof AiError ? error.message : 'the model returned invalid evidence or source references. Review the model selection and retry.'}`
    );
    this.name = 'AiStageError';
    this.cause = error;
  }
}

/** Separately selected, bounded stages; retries never select a different model. */
export async function generateStructuredStage<T>(input: {
  stage: string;
  label: string;
  selection: AiModelSelection;
  capabilities: AiModelCapability[];
  schema: z.ZodType<T>;
  promptVersion: string;
  schemaVersion: string;
  system: string;
  prompt?: string;
  messages?: ModelMessage[];
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputTokens?: number;
  retries?: number;
  validate?: (output: T) => T;
  onDiagnostics?: (diagnostics: StageDiagnostics) => void;
  onGenerationDiagnostics?: (diagnostics: GenerationDiagnostics) => void;
}): Promise<{ output: T; diagnostics: StageDiagnostics }> {
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? 120_000;
  const maxOutputTokens = input.maxOutputTokens ?? 4096;
  const retries = input.retries ?? 0;
  if (
    !Number.isInteger(retries) ||
    retries < 0 ||
    retries > 2 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 480_000 ||
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 1 ||
    maxOutputTokens > 32_768
  ) {
    throw new AiError('CONFIGURATION_ERROR', 'The inference stage budget is invalid.');
  }
  const timer = AbortSignal.timeout(timeoutMs);
  const signal = input.signal ? AbortSignal.any([input.signal, timer]) : timer;
  const diagnostics: StageDiagnostics = {
    stage: input.stage,
    selection: { ...input.selection },
    promptVersion: input.promptVersion,
    schemaVersion: input.schemaVersion,
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    timeoutMs,
    maxOutputTokens,
    attempts: 0,
    status: 'failed',
  };
  // Even a provider that fails to honor cancellation cannot hold the application lease forever.
  let abortListener: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abortListener = () => reject(signal.reason);
    if (signal.aborted) {
      abortListener();
    } else {
      signal.addEventListener('abort', abortListener, { once: true });
    }
  });
  try {
    const work = async () => {
      signal.throwIfAborted();
      await validateModelSelection(input.selection, input.capabilities, signal);
      for (;;) {
        diagnostics.attempts += 1;
        try {
          signal.throwIfAborted();
          const result = await generateStructured({
            selection: input.selection,
            schema: input.schema,
            system: input.system,
            prompt: input.prompt ?? '',
            ...(input.messages ? { messages: input.messages } : {}),
            signal,
            timeoutMs,
            maxOutputTokens,
            onDiagnostics: input.onGenerationDiagnostics,
          });
          signal.throwIfAborted();
          const output = input.schema.parse(result);
          return input.validate ? input.validate(output) : output;
        } catch (error) {
          if (
            signal.aborted ||
            diagnostics.attempts > retries ||
            (error instanceof AiError && error.code !== 'INVALID_PROVIDER_RESPONSE')
          ) {
            throw error;
          }
        }
      }
    };
    const output = await Promise.race([work(), aborted]);
    diagnostics.status = 'completed';
    return { output, diagnostics };
  } catch (error) {
    diagnostics.status = input.signal?.aborted
      ? 'cancelled'
      : timer.aborted
        ? 'timedOut'
        : 'failed';
    diagnostics.errorCode = error instanceof AiError ? error.code : 'INVALID_PROVIDER_RESPONSE';
    throw new AiStageError(input.stage, input.label, error, diagnostics);
  } finally {
    diagnostics.durationMs = Date.now() - started;
    if (abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
    input.onDiagnostics?.({ ...diagnostics });
  }
}
