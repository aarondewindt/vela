import type { UIMessageChunk } from 'ai';
import type { PlannerDebug } from './debug-schema';

const sensitive =
  /^(authorization|cookie|password|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|connectionString|headers)$/i;
export function debugText(value: string) {
  return value
    .replace(/\bBearer\s+[^\s"',}]+/gi, 'Bearer [redacted]')
    .replace(/\b([a-z][a-z0-9+.-]{0,20}:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(
      /\b(password|api[-_]?key|access[-_]?token|refresh[-_]?token|secret)\s*[=:]\s*[^\s,;}]+/gi,
      '$1=[redacted]'
    );
}
export function debugDetails(value: unknown) {
  let text: string;
  try {
    text =
      JSON.stringify(
        value,
        (key, item: unknown) => {
          if (sensitive.test(key)) {
            return '[redacted]';
          }
          if (item instanceof Error) {
            return { name: item.name, message: debugText(item.message) };
          }
          return typeof item === 'string' ? debugText(item) : item;
        },
        2
      ) ?? String(value);
  } catch {
    text = 'Details could not be serialized.';
  }
  return text.length > 8000 ? `${text.slice(0, 7960)}\n[truncated]` : text;
}

export function createPlannerTrace(now = Date.now()) {
  const events: PlannerDebug['events'] = [];
  let omittedEvents = 0;
  let sequence = 0;
  return {
    record(kind: PlannerDebug['events'][number]['kind'], label: string, details: unknown) {
      const timestamp = Date.now();
      events.push({
        id: String(++sequence),
        at: new Date(timestamp).toISOString(),
        elapsedMs: Math.max(0, timestamp - now),
        kind,
        label: debugText(label).slice(0, 500),
        details: debugDetails(details),
      });
      while (events.length > 40 || JSON.stringify(events).length > 48000) {
        events.splice(events.length > 1 ? 1 : 0, 1);
        omittedEvents++;
      }
    },
    snapshot(): PlannerDebug {
      return { events: events.map((event) => ({ ...event })), omittedEvents };
    },
  };
}
export type PlannerTrace = ReturnType<typeof createPlannerTrace>;

export function observeToolChunk(trace: PlannerTrace, chunk: UIMessageChunk) {
  if (chunk.type === 'tool-input-available') {
    trace.record('tool-input', `Call ${chunk.toolName}`, {
      toolCallId: chunk.toolCallId,
      tool: chunk.toolName,
      arguments: chunk.input,
    });
  } else if (chunk.type === 'tool-input-error') {
    trace.record('tool-error', `Invalid arguments for ${chunk.toolName}`, {
      toolCallId: chunk.toolCallId,
      input: chunk.input,
      error: chunk.errorText,
    });
  } else if (chunk.type === 'tool-output-available') {
    trace.record('tool-output', 'Tool reply', {
      toolCallId: chunk.toolCallId,
      output: chunk.output,
    });
  } else if (chunk.type === 'tool-output-error') {
    trace.record('tool-error', 'Tool failed', {
      toolCallId: chunk.toolCallId,
      error: chunk.errorText,
    });
  }
}
