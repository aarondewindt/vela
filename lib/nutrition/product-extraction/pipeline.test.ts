/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/ai/structured', () => ({ generateStructured: jest.fn() }));
jest.mock('@/lib/ai/ollama', () => ({ validateModelSelection: jest.fn() }));
import { generateStructured } from '@/lib/ai/structured';
import { validateModelSelection } from '@/lib/ai/ollama';
import { AiError } from '@/lib/ai/errors';
import { runProductExtractionPipeline } from './pipeline';
import {
  milkTranscription as milkSource,
  compactMilkSource,
  compactMilkInterpretation as milkInterpretation,
} from './pipeline-fixtures';

const selections = {
  transcription: { provider: 'ollama' as const, modelId: 'gemma3:12b' },
  interpretation: { provider: 'ollama' as const, modelId: 'qwen3:8b' },
};
const input = {
  selections,
  messages: [
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: 'Private user correction must not contaminate OCR' },
        { type: 'file' as const, data: new Uint8Array([1]), mediaType: 'image/png' },
        { type: 'file' as const, data: new Uint8Array([2]), mediaType: 'image/png' },
      ],
    },
  ],
  photographOccurrences: ['front', 'back'],
};
beforeEach(() => {
  jest.resetAllMocks();
  jest
    .mocked(generateStructured)
    .mockResolvedValueOnce(milkSource())
    .mockResolvedValueOnce(milkInterpretation());
});
it('executes separately selected stages and snapshots attribution, versions, provenance and original evidence', async () => {
  const checkpoint = jest.fn();
  const result = await runProductExtractionPipeline({ ...input, saveCheckpoint: checkpoint });
  expect(result.product.protein).toBe('3.5');
  expect(result.pipeline).toMatchObject({
    version: 'nutrition-two-stage-v1',
    evidence: compactMilkSource(),
    diagnostics: {
      transcription: { selection: selections.transcription },
      interpretation: { selection: selections.interpretation },
      normalization: { status: 'completed' },
    },
  });
  const [vision, text] = jest.mocked(generateStructured).mock.calls.map(([call]) => call);
  expect(vision.selection).toEqual(selections.transcription);
  expect(JSON.stringify(vision.messages)).toContain('Source photograph ID: front');
  expect(JSON.stringify(vision.messages)).not.toContain('Private user correction');
  expect(text).not.toHaveProperty('messages');
  expect(text.selection).toEqual(selections.interpretation);
  expect(JSON.parse(text.prompt)).toHaveProperty('numericTokens.source:1:table:0:row:3:cell:0', [
    '3,5',
  ]);
  expect(validateModelSelection).toHaveBeenNthCalledWith(
    1,
    selections.transcription,
    ['chat', 'vision'],
    expect.any(AbortSignal)
  );
  expect(validateModelSelection).toHaveBeenNthCalledWith(
    2,
    selections.interpretation,
    ['chat'],
    expect.any(AbortSignal)
  );
  expect(checkpoint.mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(generateStructured).mock.invocationCallOrder[1]
  );
});
it('keeps validated transcription through interpretation failure and reuses it with a different text model', async () => {
  let saved: unknown;
  jest
    .mocked(generateStructured)
    .mockReset()
    .mockResolvedValueOnce(milkSource())
    .mockRejectedValueOnce(new AiError('MODEL_NOT_FOUND', 'Text model is unavailable.'));
  await expect(
    runProductExtractionPipeline({
      ...input,
      saveCheckpoint: async (value) => {
        saved = value;
      },
    })
  ).rejects.toMatchObject({
    stage: 'interpretation',
    message: 'Text interpretation failed: Text model is unavailable.',
  });
  jest.mocked(generateStructured).mockReset().mockResolvedValue(milkInterpretation());
  const result = await runProductExtractionPipeline({
    ...input,
    checkpoint: saved,
    selections: { ...selections, interpretation: { provider: 'ollama', modelId: 'qwen3:14b' } },
  });
  expect(generateStructured).toHaveBeenCalledTimes(1);
  expect(result.pipeline?.diagnostics.transcription).toMatchObject({
    selection: selections.transcription,
    reused: true,
  });
  expect(result.pipeline?.diagnostics.interpretation.selection.modelId).toBe('qwen3:14b');
});
it.each(['explicit-reread', 'changed-image', 'changed-vision-model'] as const)(
  'invalidates cached evidence on %s',
  async (reason) => {
    let checkpoint: unknown;
    await runProductExtractionPipeline({
      ...input,
      saveCheckpoint: async (value) => {
        checkpoint = value;
      },
    });
    jest
      .mocked(generateStructured)
      .mockReset()
      .mockResolvedValueOnce(milkSource())
      .mockResolvedValueOnce(milkInterpretation());
    const next = {
      ...input,
      checkpoint,
      ...(reason === 'explicit-reread' ? { rereadImages: true } : {}),
      ...(reason === 'changed-vision-model'
        ? {
            selections: {
              ...selections,
              transcription: { provider: 'ollama' as const, modelId: 'vision2' },
            },
          }
        : {}),
    };
    if (reason === 'changed-image') {
      next.photographOccurrences = ['front', 'other'];
      const source = milkSource();
      source.photographs[1].id = 'other';
      jest
        .mocked(generateStructured)
        .mockReset()
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(milkInterpretation());
    }
    await runProductExtractionPipeline(next);
    expect(generateStructured).toHaveBeenCalledTimes(2);
  }
);
it('reports invalid interpretation references at the text stage without direct-extraction fallback', async () => {
  const mapping = milkInterpretation();
  mapping.columns[0].values[0].amount!.cellId = 'invented';
  jest
    .mocked(generateStructured)
    .mockReset()
    .mockResolvedValueOnce(milkSource())
    .mockResolvedValueOnce(mapping);
  await expect(runProductExtractionPipeline(input)).rejects.toMatchObject({
    stage: 'interpretation',
    diagnostics: { attempts: 1 },
  });
  expect(generateStructured).toHaveBeenCalledTimes(2);
});
it('cancels between stages without discarding the completed evidence checkpoint', async () => {
  const controller = new AbortController();
  const checkpoint = jest.fn(async () => {
    controller.abort();
  });
  await expect(
    runProductExtractionPipeline({
      ...input,
      signal: controller.signal,
      saveCheckpoint: checkpoint,
    })
  ).rejects.toMatchObject({ stage: 'interpretation', diagnostics: { status: 'cancelled' } });
  expect(checkpoint).toHaveBeenCalledTimes(2);
  expect(checkpoint).toHaveBeenLastCalledWith(
    expect.objectContaining({
      evidence: compactMilkSource(),
      lastFailure: expect.objectContaining({ stage: 'interpretation' }),
    })
  );
  expect(generateStructured).toHaveBeenCalledTimes(1);
});

it('persists only safe failed-stage diagnostics even when transcription fails', async () => {
  const saveCheckpoint = jest.fn();
  jest
    .mocked(generateStructured)
    .mockReset()
    .mockRejectedValue(new Error('private extracted value and provider payload'));
  await expect(runProductExtractionPipeline({ ...input, saveCheckpoint })).rejects.toMatchObject({
    stage: 'transcription',
  });
  const failure = saveCheckpoint.mock.calls[0][0];
  expect(failure).toMatchObject({
    pipeline: 'nutrition-two-stage-v1',
    lastFailure: {
      stage: 'transcription',
      diagnostics: { status: 'failed', selection: selections.transcription },
    },
  });
  expect(failure).not.toHaveProperty('evidence');
  expect(JSON.stringify(failure)).not.toContain('private extracted');
});

it('freezes both model selections before checkpoint callbacks can change external settings', async () => {
  const mutable = structuredClone(selections);
  const result = await runProductExtractionPipeline({
    ...input,
    selections: mutable,
    saveCheckpoint: async () => {
      mutable.interpretation.modelId = 'different-later';
    },
  });
  expect(result.pipeline?.diagnostics.interpretation.selection.modelId).toBe('qwen3:8b');
  expect(jest.mocked(generateStructured).mock.calls[1][0].selection.modelId).toBe('qwen3:8b');
});
