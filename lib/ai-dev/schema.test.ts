import { chatInputSchema, maxMessageLength } from './schema';

const message = { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] };
const input = { conversationId: '45f6af99-9a30-4638-b05f-fb826b970379', message };

describe('chatInputSchema', () => {
  it('accepts the latest user message and a saved conversation ID', () => {
    expect(chatInputSchema.safeParse(input).success).toBe(true);
  });
  it('does not accept client history or model settings as authoritative', () => {
    expect(
      chatInputSchema.parse({
        ...input,
        messages: [{ role: 'system' }],
        selection: { provider: 'other' },
      })
    ).toEqual(input);
  });
  it.each([
    { ...input, conversationId: 'invalid' },
    { ...input, message: { ...message, id: '' } },
    { ...input, message: { ...message, role: 'assistant' } },
    { ...input, message: { ...message, role: 'system' } },
    { ...input, message: { ...message, parts: [] } },
    { ...input, message: { ...message, parts: [{ type: 'text', text: '   ' }] } },
    { ...input, message: { ...message, parts: [{ type: 'file' }] } },
    { ...input, message: { ...message, parts: [{ type: 'tool-example' }] } },
    {
      ...input,
      message: { ...message, parts: [{ type: 'text', text: 'x'.repeat(maxMessageLength + 1) }] },
    },
    {
      ...input,
      message: {
        ...message,
        parts: Array.from({ length: 2 }, () => ({
          type: 'text',
          text: 'x'.repeat(maxMessageLength),
        })),
      },
    },
  ])('rejects invalid or unsupported requests', (body) => {
    expect(chatInputSchema.safeParse(body).success).toBe(false);
  });
});
