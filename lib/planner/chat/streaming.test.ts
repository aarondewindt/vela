/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/ai', () => ({ resolveChatModel: jest.fn() }));
jest.mock('ai', () => ({
  convertToModelMessages: jest.fn(),
  streamText: jest.fn(),
  stepCountIs: jest.fn(),
  toUIMessageStream: jest.fn(),
  createUIMessageStream: jest.fn(),
  createUIMessageStreamResponse: jest.fn(),
}));
import { createUIMessageStream, toUIMessageStream, streamText, convertToModelMessages } from 'ai';
import { resolveChatModel } from '@/lib/ai';
import { streamPlanningTurn } from './streaming';
import { storedPartsSchema } from '@/lib/ai-dev/schema';

const input = {
  conversationId: '00000000-0000-4000-8000-000000000001',
  message: {
    id: 'u',
    role: 'user' as const,
    parts: [{ type: 'text' as const, text: 'Plan the rest of the day' }],
  },
};
const store = { finishTurn: jest.fn() };
const turn = {
  selection: { provider: 'ollama', modelId: 'qwen3:8b' },
  generationId: 'lease',
  history: [input.message],
  response: { id: 'reply', role: 'assistant', parts: [] },
};
let chunks: any[];
let finishReason: string;
let outcome: string;
beforeEach(() => {
  jest.resetAllMocks();
  chunks = [];
  finishReason = 'stop';
  outcome = 'completed';
  jest.mocked(streamText).mockReturnValue({ stream: {} } as any);
  jest.mocked(toUIMessageStream).mockImplementation((options: any) => {
    let index = 0;
    return new ReadableStream({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(chunks[index++]);
        } else {
          options.onEnd({ outcome: { status: outcome }, finishReason });
          controller.close();
        }
      },
    }) as any;
  });
});
async function run(options = {}) {
  await streamPlanningTurn({
    store,
    turn,
    userId: 'owner',
    input,
    signal: new AbortController().signal,
    system: 'Planner',
    tools: { generateDayPlan: {} },
    ...options,
  } as any);
  const callbacks = jest.mocked(createUIMessageStream).mock.calls[0][0] as any;
  const writer = { write: jest.fn(), setOutcome: jest.fn() };
  await callbacks.execute({ writer });
  const output = chunks
    .filter((chunk) => chunk.type === 'tool-output-available')
    .map((chunk) => ({ type: 'tool-generateDayPlan', output: chunk.output }));
  const deltas = writer.write.mock.calls
    .map(([chunk]) => chunk)
    .filter((chunk) => chunk.type === 'text-delta');
  await callbacks.onEnd({
    responseMessage: {
      ...turn.response,
      parts: [...output, ...deltas.map((chunk) => ({ type: 'text', text: chunk.delta }))],
    },
    ...('endEvent' in options ? (options as any).endEvent : {}),
  });
  return {
    writer,
    message: store.finishTurn.mock.calls[0][3],
    status: store.finishTurn.mock.calls[0][4],
  };
}
it('records interpretation/tool arguments/results and persists compact cards with diagnostics', async () => {
  const result = {
    date: '2030-01-07',
    reply: 'Review preview',
    proposalId: '00000000-0000-4000-8000-000000000009',
  };
  chunks = [
    {
      type: 'tool-input-available',
      toolName: 'generateDayPlan',
      toolCallId: 'tool-1',
      input: { date: result.date, guidance: input.message.parts[0].text },
    },
    { type: 'tool-output-available', toolCallId: 'tool-1', output: result },
  ];
  const { message, status } = await run();
  expect(status).toBe('COMPLETED');
  expect(message.parts).toContainEqual({ type: 'data-planning', data: result });
  const debug = message.parts.find((part: any) => part.type === 'data-plannerDebug').data;
  expect(debug.events.map((event: any) => event.kind)).toEqual([
    'request',
    'tool-input',
    'tool-output',
    'finish',
  ]);
  expect(debug.events[1].details).toContain('guidance');
  expect(storedPartsSchema.safeParse(message.parts).success).toBe(true);
  expect(store.finishTurn).toHaveBeenCalledWith(
    'owner',
    input.conversationId,
    'lease',
    message,
    'COMPLETED'
  );
});
it('disables Qwen thinking and records an actionable empty/length failure instead of a blank reply', async () => {
  finishReason = 'length';
  const { message, status, writer } = await run();
  expect(streamText).toHaveBeenCalledWith(
    expect.objectContaining({
      providerOptions: { ollama: { think: false } },
      maxOutputTokens: 4096,
      timeout: 150000,
    })
  );
  expect(status).toBe('FAILED');
  expect(message.parts.find((part: any) => part.type === 'text').text).toContain(
    'output-token limit'
  );
  expect(writer.setOutcome).toHaveBeenCalledWith({ status: 'failed' });
});
it('retains malformed arguments and tool errors even if the model produces no follow-up', async () => {
  chunks = [
    {
      type: 'tool-input-error',
      toolName: 'generateDayPlan',
      toolCallId: 'bad',
      input: { wrong: true },
      errorText: 'Invalid date',
    },
  ];
  const { message, status } = await run();
  expect(status).toBe('FAILED');
  const debug = message.parts.find((part: any) => part.type === 'data-plannerDebug').data;
  expect(debug.events.find((event: any) => event.kind === 'tool-error').details).toContain(
    'Invalid date'
  );
  expect(message.parts.find((part: any) => part.type === 'text').text).toContain(
    'planning tool failed'
  );
  const conversion = jest.mocked(toUIMessageStream).mock.calls[0][0] as any;
  expect(conversion.onError(new Error('Scheduler unavailable: Bearer private-key'))).toContain(
    'Scheduler unavailable'
  );
  expect(conversion.onError(new Error('Scheduler unavailable: Bearer private-key'))).not.toContain(
    'private-key'
  );
});
it('saves setup/provider failures with bounded redacted errors', async () => {
  jest.mocked(resolveChatModel).mockRejectedValue(new Error('Offline: Bearer sensitive-token'));
  const { message, status } = await run();
  expect(status).toBe('FAILED');
  expect(JSON.stringify(message)).toContain('Offline');
  expect(JSON.stringify(message)).not.toContain('sensitive-token');
  expect(storedPartsSchema.safeParse(message.parts).success).toBe(true);
});
it('keeps cancellation distinct from empty completion', async () => {
  const signal = AbortSignal.abort();
  const { message, status } = await run({ signal, endEvent: { isCancelled: true } });
  expect(status).toBe('INTERRUPTED');
  expect(message.parts.find((part: any) => part.type === 'text').text).toContain('cancelled');
});
it('bounds planning history and excludes saved debug data from future model prompts', async () => {
  const history = Array.from({ length: 30 }, (_, id) => ({
    ...input.message,
    id: String(id),
    parts: [
      { type: 'text', text: 'x'.repeat(3000) },
      { type: 'data-plannerDebug', data: { privateDebug: true } },
    ],
  }));
  await run({ turn: { ...turn, history } });
  const passed = jest.mocked(convertToModelMessages).mock.calls[0][0];
  expect(passed).toHaveLength(12);
  expect(JSON.stringify(passed)).not.toContain('privateDebug');
  expect(JSON.stringify(passed).length).toBeLessThan(26000);
});
