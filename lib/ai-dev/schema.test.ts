import { chatInputSchema, maxMessageLength } from './schema';

const message = { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] };
const input = { selection: { provider: 'ollama', modelId: 'chat:latest' }, messages: [message] };

describe('chatInputSchema', () => {
  it('accepts text history including SDK step markers and text state', () => {
    expect(
      chatInputSchema.safeParse({
        ...input,
        messages: [
          message,
          {
            id: 'assistant-1',
            role: 'assistant',
            parts: [{ type: 'step-start' }, { type: 'text', text: 'Hi', state: 'done' }],
          },
          { ...message, id: 'user-2' },
        ],
      }).success
    ).toBe(true);
  });

  it.each([
    { ...input, selection: { provider: 'other', modelId: 'chat:latest' } },
    { ...input, selection: { provider: 'ollama', modelId: '' } },
    { ...input, messages: [] },
    { ...input, messages: [{ ...message, role: 'system' }] },
    { ...input, messages: [{ ...message, role: 'assistant' }] },
    { ...input, messages: [{ ...message, parts: [{ type: 'text', text: '  ' }] }] },
    {
      ...input,
      messages: [{ ...message, parts: [{ type: 'file', url: 'https://example.com/private' }] }],
    },
    { ...input, messages: [{ ...message, parts: [{ type: 'tool-example', toolCallId: 'call' }] }] },
    { ...input, messages: [message, message] },
    {
      ...input,
      messages: [{ ...message, parts: [{ type: 'text', text: 'x'.repeat(maxMessageLength + 1) }] }],
    },
    { ...input, messages: Array.from({ length: 101 }, (_, i) => ({ ...message, id: String(i) })) },
    {
      ...input,
      messages: Array.from({ length: 5 }, (_, i) => ({
        ...message,
        id: String(i),
        parts: [{ type: 'text', text: 'x'.repeat(maxMessageLength) }],
      })),
    },
  ])('rejects invalid or unsupported chat requests', (body) => {
    expect(chatInputSchema.safeParse(body).success).toBe(false);
  });
});
