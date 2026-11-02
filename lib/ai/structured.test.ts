/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('ai', () => ({ generateText: jest.fn(), Output: { object: jest.fn((input) => input) } }));
jest.mock('./ollama', () => ({ resolveChatModel: jest.fn() }));
import { z } from 'zod';
import { generateText, Output } from 'ai';
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

it('captures bounded raw output, finish reason and validation causes without request metadata', async () => {
  const cause = new Error('quantity must be a string');
  const failure = Object.assign(new Error('Response did not match schema', { cause }), {
    text: 'x'.repeat(25_000),
    finishReason: 'length',
    request: { headers: { authorization: 'secret' } },
    response: { headers: { 'set-cookie': 'secret' } },
  });
  (generateText as jest.Mock).mockRejectedValue(failure);
  const onDiagnostics = jest.fn();
  await expect(generateStructured({ ...input, onDiagnostics })).rejects.toThrow('saved work');
  expect(onDiagnostics).toHaveBeenCalledWith(
    expect.objectContaining({
      modelId: 'chat',
      finishReason: 'length',
      durationMs: expect.any(Number),
      errors: [
        { name: 'Error', message: 'Response did not match schema' },
        { name: 'Error', message: 'quantity must be a string' },
      ],
    })
  );
  const details = onDiagnostics.mock.calls[0][0];
  expect(details.rawResponse).toHaveLength(20_033);
  expect(JSON.stringify(details)).not.toContain('secret');
});
it('captures successful output and preserves model resolution errors', async () => {
  const onDiagnostics = jest.fn();
  (generateText as jest.Mock).mockResolvedValue({
    output: { value: 'ok' },
    text: '{"value":"ok"}',
    finishReason: 'stop',
  });
  await generateStructured({ ...input, onDiagnostics });
  expect(onDiagnostics).toHaveBeenLastCalledWith(
    expect.objectContaining({ rawResponse: '{"value":"ok"}', finishReason: 'stop' })
  );
  const { AiError } = await import('./errors');
  (resolveChatModel as jest.Mock).mockRejectedValue(
    new AiError('MODEL_NOT_FOUND', 'Select an installed model.')
  );
  await expect(generateStructured({ ...input, onDiagnostics })).rejects.toMatchObject({
    code: 'MODEL_NOT_FOUND',
  });
  expect(onDiagnostics).toHaveBeenLastCalledWith(
    expect.objectContaining({
      errors: [{ name: 'AiError', message: 'Select an installed model.' }],
    })
  );
});

it('aborts timed-out inference, masks provider details and records the failure', async () => {
  const timeout = new AbortController();
  const original = AbortSignal.timeout;
  jest
    .spyOn(AbortSignal, 'timeout')
    .mockImplementation((ms) => (ms === 120_000 ? timeout.signal : original(ms)));
  const onDiagnostics = jest.fn();
  try {
    (generateText as jest.Mock).mockImplementation(
      ({ abortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal.addEventListener('abort', () => reject(new Error('private provider body')), {
            once: true,
          });
          timeout.abort(Object.assign(new Error('Timed out'), { name: 'TimeoutError' }));
        })
    );
    await expect(generateStructured({ ...input, onDiagnostics })).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESPONSE',
    });
    expect(onDiagnostics).toHaveBeenLastCalledWith(
      expect.objectContaining({
        aborted: true,
        errors: expect.arrayContaining([{ name: 'TimeoutError', message: 'Timed out' }]),
      })
    );
  } finally {
    jest.restoreAllMocks();
  }
});

it('passes multimodal messages together through schema-constrained generation', async () => {
  const messages = [
    {
      role: 'user' as const,
      content: [
        { type: 'file' as const, data: new Uint8Array([1]), mediaType: 'image/png' },
        { type: 'file' as const, data: new Uint8Array([2]), mediaType: 'image/png' },
      ],
    },
  ];
  (generateText as jest.Mock).mockResolvedValue({ output: { value: 'front and back' } });
  await expect(generateStructured({ ...input, prompt: '', messages })).resolves.toEqual({
    value: 'front and back',
  });
  const options = (generateText as jest.Mock).mock.calls[0][0];
  expect(options.messages).toBe(messages);
  expect(options).not.toHaveProperty('prompt');
  expect(Output.object).toHaveBeenCalledWith({ schema: input.schema });
});

it('bounds textual context in multimodal messages before resolving the model', async () => {
  await expect(
    generateStructured({
      ...input,
      prompt: '',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(64_001) }] }],
    })
  ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  expect(resolveChatModel).not.toHaveBeenCalled();
});

it('passes an explicitly bounded stage budget through SDK and Ollama transport', async () => {
  (generateText as jest.Mock).mockResolvedValue({ output: { value: 'ok' } });
  const onDiagnostics = jest.fn();
  await generateStructured({ ...input, timeoutMs: 240_000, maxOutputTokens: 8192, onDiagnostics });
  expect(resolveChatModel).toHaveBeenCalledWith(input.selection, expect.any(AbortSignal), 240_000);
  expect(generateText).toHaveBeenCalledWith(
    expect.objectContaining({ timeout: 240_000, maxOutputTokens: 8192 })
  );
  expect(onDiagnostics).toHaveBeenCalledWith(
    expect.objectContaining({ timeoutMs: 240_000, maxOutputTokens: 8192 })
  );
  await expect(generateStructured({ ...input, timeoutMs: 999_999 })).rejects.toMatchObject({
    code: 'CONFIGURATION_ERROR',
  });
});
