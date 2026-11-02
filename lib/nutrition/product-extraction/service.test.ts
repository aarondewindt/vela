/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/ai', () => ({
  ...jest.requireActual('@/lib/ai/errors'),
  generateStructured: jest.fn(),
}));
jest.mock('../product-chat/service', () => ({ productChat: { completeTurn: jest.fn() } }));
jest.mock('./pipeline', () => ({
  runProductExtractionPipeline: jest.fn(),
  transcriptionFingerprint: jest.fn(() => 'fingerprint'),
}));
import { generateStructured } from '@/lib/ai';
import { productChat } from '../product-chat/service';
import { extractProduct, extractProductDirect } from './service';
import { runProductExtractionPipeline } from './pipeline';
import { normalizeColumnExtraction } from './normalize';
import { milkColumns } from './fixtures';

const input = {
  conversationId: '45f6af99-9a30-4638-b05f-fb826b970379',
  message: {
    id: 'turn-1',
    role: 'user' as const,
    parts: [{ type: 'text' as const, text: 'Extract this product' }],
  },
};
const signal = new AbortController().signal;
const context = {
  messages: [{ role: 'user' as const, content: 'Authorized image history' }],
  selection: { provider: 'ollama' as const, modelId: 'vision' },
  stageSelections: {
    transcription: { provider: 'ollama' as const, modelId: 'vision' },
    interpretation: { provider: 'ollama' as const, modelId: 'text' },
  },
  history: [
    {
      id: 'old',
      role: 'user' as const,
      parts: [
        {
          type: 'data-attachment' as const,
          data: { attachmentId: '72321fd3-254a-4e45-9663-c399ae0621f4' },
        },
        { type: 'text' as const, text: 'The brand is Jumbo' },
      ],
    },
  ],
  checkpoint: undefined as unknown,
  saveCheckpoint: jest.fn(),
  signal,
};
beforeEach(() => {
  jest.resetAllMocks();
  jest
    .mocked(productChat.completeTurn)
    .mockImplementation(async (_owner, _input, _signal, generate) => ({
      id: 'reply-1',
      role: 'assistant',
      parts: await generate(context),
    }));
  jest
    .mocked(runProductExtractionPipeline)
    .mockResolvedValue(normalizeColumnExtraction(milkColumns()));
});
it('uses the shared authoritative lifecycle and two separately resolved stage selections by default', async () => {
  const response = await extractProduct('alice', input, signal);
  expect(productChat.completeTurn).toHaveBeenCalledWith(
    'alice',
    input,
    signal,
    expect.any(Function)
  );
  expect(runProductExtractionPipeline).toHaveBeenCalledWith(
    expect.objectContaining({
      selections: context.stageSelections,
      messages: context.messages,
      photographOccurrences: ['72321fd3-254a-4e45-9663-c399ae0621f4'],
      saveCheckpoint: context.saveCheckpoint,
      corrections: [{ id: 'user:old', messageId: 'old', text: 'The brand is Jumbo' }],
    })
  );
  expect(response.suggestion.product.protein).toBe('3.5');
  expect(response.messageId).toBe('reply-1');
  expect(generateStructured).not.toHaveBeenCalled();
});
it('retains legacy direct extraction only through its explicit diagnostic entry point', async () => {
  jest.mocked(generateStructured).mockResolvedValue(milkColumns());
  expect((await extractProductDirect('alice', input, signal)).suggestion.product.protein).toBe(
    '3.5'
  );
  expect(runProductExtractionPipeline).not.toHaveBeenCalled();
});
it('rejects invalid suggestions and reports pipeline failure without falling back', async () => {
  jest.mocked(runProductExtractionPipeline).mockResolvedValue({ name: 'invalid' } as never);
  await expect(extractProduct('alice', input, signal)).rejects.toThrow();
  jest
    .mocked(runProductExtractionPipeline)
    .mockRejectedValue(new Error('Text interpretation failed'));
  await expect(extractProduct('alice', input, signal)).rejects.toThrow(
    'Text interpretation failed'
  );
  expect(generateStructured).not.toHaveBeenCalled();
});
it.each([
  { text: 'Look again at protein', rereadImages: undefined },
  { text: 'Extract', rereadImages: true },
])(
  'passes explicit visual reread requests and text-only corrections without requiring reupload',
  async ({ text, rereadImages }) => {
    await extractProduct(
      'alice',
      {
        ...input,
        rereadImages,
        message: { ...input.message, id: 'turn-2', parts: [{ type: 'text', text }] },
      },
      signal
    );
    expect(runProductExtractionPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        rereadImages: true,
        photographOccurrences: ['72321fd3-254a-4e45-9663-c399ae0621f4'],
      })
    );
  }
);
it('replays a saved suggestion without another model call', async () => {
  const suggestion = normalizeColumnExtraction(milkColumns());
  jest.mocked(productChat.completeTurn).mockResolvedValue({
    id: 'reply-1',
    role: 'assistant',
    parts: [{ type: 'data-productSuggestion', data: suggestion }],
  });
  expect((await extractProduct('alice', input)).suggestion).toEqual(suggestion);
  expect(runProductExtractionPipeline).not.toHaveBeenCalled();
});
