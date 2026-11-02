/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('./structured', () => ({ generateStructured: jest.fn() }));
jest.mock('./ollama', () => ({ validateModelSelection: jest.fn() }));
import { z } from 'zod';
import { generateStructured } from './structured';
import { validateModelSelection } from './ollama';
import { generateStructuredStage } from './stages';
import { AiError } from './errors';

const input = {
  stage: 'transcription',
  label: 'Vision transcription',
  selection: { provider: 'ollama' as const, modelId: 'vision' },
  capabilities: ['chat' as const, 'vision' as const],
  schema: z.object({ value: z.string() }),
  promptVersion: 'p1',
  schemaVersion: 's1',
  system: 'Transcribe',
  prompt: 'test',
  timeoutMs: 1000,
};
beforeEach(() => {
  jest.resetAllMocks();
});
it('validates the exact stage capability and records attribution without private output', async () => {
  jest.mocked(generateStructured).mockResolvedValue({ value: 'private label' });
  const { output, diagnostics } = await generateStructuredStage(input);
  expect(output).toEqual({ value: 'private label' });
  expect(validateModelSelection).toHaveBeenCalledWith(
    input.selection,
    ['chat', 'vision'],
    expect.any(AbortSignal)
  );
  expect(diagnostics).toMatchObject({
    status: 'completed',
    attempts: 1,
    selection: input.selection,
    durationMs: expect.any(Number),
  });
  expect(JSON.stringify(diagnostics)).not.toContain('private label');
});
it('uses bounded explicit retries with the same selection and no automatic retries by default', async () => {
  jest
    .mocked(generateStructured)
    .mockRejectedValueOnce(new AiError('INVALID_PROVIDER_RESPONSE', 'Invalid'))
    .mockResolvedValue({ value: 'ok' });
  await expect(generateStructuredStage({ ...input, retries: 1 })).resolves.toMatchObject({
    output: { value: 'ok' },
    diagnostics: { attempts: 2 },
  });
  expect(jest.mocked(generateStructured).mock.calls.map(([call]) => call.selection)).toEqual([
    input.selection,
    input.selection,
  ]);
  jest.mocked(generateStructured).mockReset().mockRejectedValue(new Error('private data'));
  await expect(generateStructuredStage(input)).rejects.toMatchObject({
    stage: 'transcription',
    diagnostics: { attempts: 1 },
  });
  expect(generateStructured).toHaveBeenCalledTimes(1);
});
it('rejects unavailable/incompatible selections without inference and preserves stage errors', async () => {
  jest
    .mocked(validateModelSelection)
    .mockRejectedValue(new AiError('MODEL_NOT_SUPPORTED', 'Requires vision.'));
  await expect(generateStructuredStage(input)).rejects.toMatchObject({
    code: 'MODEL_NOT_SUPPORTED',
    stage: 'transcription',
    message: 'Vision transcription failed: Requires vision.',
  });
  expect(generateStructured).not.toHaveBeenCalled();
});
it('bounds even uncooperative inference and identifies cancellation separately', async () => {
  jest.useFakeTimers();
  const controller = new AbortController();
  jest.mocked(generateStructured).mockImplementation(() => new Promise(() => {}));
  const pending = generateStructuredStage({ ...input, signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toMatchObject({
    stage: 'transcription',
    diagnostics: { status: 'cancelled' },
  });
  jest.useRealTimers();
});
it('rejects invalid budget configuration before work', async () => {
  await expect(generateStructuredStage({ ...input, retries: 3 })).rejects.toMatchObject({
    code: 'CONFIGURATION_ERROR',
  });
  expect(validateModelSelection).not.toHaveBeenCalled();
});

it('reports a stage timeout separately from user cancellation and masks original details', async () => {
  const timer = new AbortController();
  const original = AbortSignal.timeout;
  jest
    .spyOn(AbortSignal, 'timeout')
    .mockImplementation((ms) => (ms === 777 ? timer.signal : original(ms)));
  jest.mocked(generateStructured).mockImplementation(() => new Promise(() => {}));
  const pending = generateStructuredStage({ ...input, timeoutMs: 777 });
  await Promise.resolve();
  timer.abort(new Error('private provider details'));
  await expect(pending).rejects.toMatchObject({
    message: 'Vision transcription failed: the stage exceeded its time limit.',
    diagnostics: { status: 'timedOut' },
  });
  jest.restoreAllMocks();
});
