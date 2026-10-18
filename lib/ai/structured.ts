import 'server-only';
import { generateText, Output } from 'ai';
import type { z } from 'zod';
import { resolveChatModel, type AiModelSelection } from './ollama';
import { AiError } from './errors';

/** Shared bounded, schema-validated generation. Domain interpretation belongs to the caller. */
export async function generateStructured<T>({
  selection,
  schema,
  system,
  prompt,
  signal,
}: {
  selection: AiModelSelection;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<T> {
  if (!prompt.trim() || system.length + prompt.length > 64_000) {
    throw new AiError(
      'INVALID_PROVIDER_RESPONSE',
      'The structured-generation context is empty or too large.'
    );
  }
  const deadline = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    : AbortSignal.timeout(120_000);
  const model = await resolveChatModel(selection, deadline);
  try {
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
    return schema.parse(result.output);
  } catch {
    throw new AiError(
      'INVALID_PROVIDER_RESPONSE',
      'The model did not return a valid structured response. Your saved work is preserved; check the model and retry.'
    );
  }
}
