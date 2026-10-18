/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('ai', () => ({ generateText: jest.fn(), Output: { object: jest.fn((input) => input) } }));
jest.mock('./ollama', () => ({ resolveChatModel: jest.fn() }));
import { z } from 'zod';
import { generateText } from 'ai';
import { resolveChatModel } from './ollama';
import { generateStructured } from './structured';
const input = {
  selection: { provider: 'ollama' as const, modelId: 'chat' },
  schema: z.object({ value: z.string() }),
  system: 'Return structured data.',
  prompt: 'Synthetic test',
};
beforeEach(() => {
  jest.resetAllMocks();
  (resolveChatModel as jest.Mock).mockResolvedValue({ modelId: 'chat' });
});
it('resolves the explicit model, validates output and bounds inference without retries', async () => {
  (generateText as jest.Mock).mockResolvedValue({ output: { value: 'ok' } });
  const signal = new AbortController().signal;
  expect(await generateStructured({ ...input, signal })).toEqual({ value: 'ok' });
  expect(resolveChatModel).toHaveBeenCalledWith(input.selection, expect.any(AbortSignal));
  expect(generateText).toHaveBeenCalledWith(
    expect.objectContaining({
      maxOutputTokens: 4096,
      maxRetries: 0,
      timeout: 120_000,
      temperature: 0,
      abortSignal: expect.any(AbortSignal),
    })
  );
});
it('rejects empty or oversized context before provider work', async () => {
  await expect(generateStructured({ ...input, prompt: ' ' })).rejects.toMatchObject({
    code: 'INVALID_PROVIDER_RESPONSE',
  });
  await expect(generateStructured({ ...input, prompt: 'x'.repeat(64_001) })).rejects.toMatchObject({
    code: 'INVALID_PROVIDER_RESPONSE',
  });
  expect(resolveChatModel).not.toHaveBeenCalled();
});
it('masks malformed output and provider response bodies', async () => {
  (generateText as jest.Mock).mockResolvedValue({ output: { value: 12 } });
  await expect(generateStructured(input)).rejects.toMatchObject({
    code: 'INVALID_PROVIDER_RESPONSE',
  });
  (generateText as jest.Mock).mockRejectedValue(new Error('private response body'));
  await expect(generateStructured(input)).rejects.toThrow('Your saved work is preserved');
});
