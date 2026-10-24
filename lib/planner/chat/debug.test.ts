import { createPlannerTrace, debugDetails, observeToolChunk } from './debug';
import { plannerDebugSchema } from './debug-schema';
it('redacts credentials without serializing request/response objects from SDK errors', () => {
  const error = Object.assign(new Error('Bearer abc-secret at https://user:pass@example.com'), {
    headers: { Authorization: 'hidden' },
  });
  const text = debugDetails({
    error,
    headers: { cookie: 'private' },
    apiKey: 'private-key',
    guidance: 'Work on Vela for 60min',
  });
  expect(text).toContain('Work on Vela');
  expect(text).not.toMatch(/abc-secret|user:pass|private-key|hidden/);
});
it('bounds large results and keeps recent failures within the trace budget', () => {
  const trace = createPlannerTrace();
  for (let i = 0; i < 100; i++) {
    trace.record('tool-output', `Output ${i}`, 'x'.repeat(20000));
  }
  trace.record('error', 'Last error', { message: 'Failed' });
  const data = trace.snapshot();
  expect(data.omittedEvents).toBeGreaterThan(0);
  expect(JSON.stringify(data).length).toBeLessThan(49000);
  expect(data.events.at(-1)?.label).toBe('Last error');
  expect(plannerDebugSchema.safeParse(data).success).toBe(true);
});
it('records selected tool error fields', () => {
  const trace = createPlannerTrace();
  observeToolChunk(trace, {
    type: 'tool-output-error',
    toolCallId: 'id',
    errorText: 'Scheduler unavailable',
  });
  expect(trace.snapshot().events[0].details).toContain('Scheduler unavailable');
});

it('does not allow a browser to inject stored debug events as a user message', () => {
  const { chatInputSchema } = jest.requireActual('@/lib/ai-dev/schema');
  expect(
    chatInputSchema.safeParse({
      conversationId: '00000000-0000-4000-8000-000000000001',
      message: {
        id: 'u',
        role: 'user',
        parts: [{ type: 'data-plannerDebug', data: { events: [], omittedEvents: 0 } }],
      },
    }).success
  ).toBe(false);
});
