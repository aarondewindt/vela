/** Explicitly selected diagnostic fields; never serialize SDK errors, requests or headers wholesale. */
export type GenerationDiagnostics = {
  provider: string;
  modelId: string;
  startedAt: string;
  durationMs: number;
  maxOutputTokens: number;
  timeoutMs: number;
  rawResponse?: string;
  finishReason?: string;
  aborted?: boolean;
  errors?: { name: string; message: string }[];
};

export function diagnosticErrors(error: unknown): { name: string; message: string }[] {
  const errors: { name: string; message: string }[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current instanceof Error && errors.length < 4 && !seen.has(current)) {
    seen.add(current);
    errors.push({ name: current.name.slice(0, 100), message: current.message.slice(0, 2000) });
    current = current.cause;
  }
  return errors;
}

export function diagnosticText(text: string): string {
  return text.length > 20_000 ? `${text.slice(0, 20_000)}\n[truncated at 20,000 characters]` : text;
}
