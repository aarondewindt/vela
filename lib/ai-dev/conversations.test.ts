/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    aiConversation: {
      findMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));
jest.mock('@/lib/attachments/service', () => ({ retainAttachments: jest.fn() }));
jest.mock('@/lib/ai', () => ({ resolveChatModel: jest.fn(), validateModelSelection: jest.fn() }));

import { retainAttachments } from '@/lib/attachments/service';
import { prisma } from '@/lib/prisma';
import { resolveChatModel, validateModelSelection } from '@/lib/ai';
import { conversationService, createConversationService } from './conversations';
import type { ChatInput } from './schema';
import { normalizeColumnExtraction } from '@/lib/nutrition/product-extraction/normalize';
import { milkColumns } from '@/lib/nutrition/product-extraction/fixtures';

const id = '45f6af99-9a30-4638-b05f-fb826b970379';
const input: ChatInput = {
  conversationId: id,
  message: { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
};
const userMessage = {
  id: 'u',
  role: 'user',
  parts: [{ type: 'text', text: 'Hello', state: 'done' }],
  position: 0,
  status: 'COMPLETED',
  replyToId: null,
};
const assistant = {
  id: 'a',
  role: 'assistant',
  parts: [{ type: 'text', text: 'Partial' }],
  position: 1,
  status: 'INTERRUPTED',
  replyToId: 'u',
};
const tx = {
  product: { findFirst: jest.fn() },
  userAiModelSetting: { findMany: jest.fn() },
  aiConversation: { updateMany: jest.fn(), findFirst: jest.fn() },
  aiMessage: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
};
function conversation(messages: unknown[] = []) {
  return {
    id,
    userId: 'user-a',
    title: 'New conversation',
    provider: 'ollama',
    modelId: 'chat:latest',
    activeGenerationId: null,
    updatedAt: new Date(),
    messages,
  };
}
beforeEach(() => {
  jest.resetAllMocks();
  (prisma.$transaction as jest.Mock).mockImplementation((operation) => operation(tx));
  tx.aiConversation.updateMany.mockResolvedValue({ count: 1 });
  tx.aiConversation.findFirst.mockResolvedValue(conversation());
  tx.aiMessage.create.mockImplementation(async ({ data }) => data);
  tx.aiMessage.update.mockResolvedValue({ ...assistant, parts: [] });
  tx.userAiModelSetting.findMany.mockResolvedValue([]);
});

it('counts Product inference context without repeatedly charging persisted audit evidence', async () => {
  const suggestion = normalizeColumnExtraction(milkColumns());
  suggestion.warnings = ['Original source audit '.repeat(4000)];
  tx.aiConversation.findFirst.mockResolvedValue(
    conversation([
      { ...userMessage, id: 'older' },
      {
        ...assistant,
        status: 'COMPLETED',
        replyToId: 'older',
        parts: [
          { type: 'text', text: 'Review suggestions.' },
          { type: 'data-productSuggestion', data: suggestion },
        ],
      },
    ])
  );
  const service = createConversationService('nutrition-product');
  await expect(service.beginTurn('user-a', input)).resolves.toMatchObject({
    generationId: expect.any(String),
  });
});

describe('model inheritance and switching', () => {
  it('uses updated defaults on subsequent turns and records a model snapshot on each response', async () => {
    tx.aiConversation.findFirst.mockResolvedValue({ ...conversation(), inheritsModel: true });
    tx.userAiModelSetting.findMany
      .mockResolvedValueOnce([{ key: 'default', value: { provider: 'ollama', modelId: 'first' } }])
      .mockResolvedValueOnce([
        { key: 'default', value: { provider: 'ollama', modelId: 'second' } },
      ]);
    expect((await conversationService.beginTurn('user-a', input)).selection.modelId).toBe('first');
    expect((await conversationService.beginTurn('user-a', input)).selection.modelId).toBe('second');
    expect(tx.aiMessage.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ role: 'assistant', modelId: 'second', provider: 'ollama' }),
    });
  });
  it('does not consult changed defaults for an explicit conversation override or completed replay', async () => {
    expect((await conversationService.beginTurn('user-a', input)).selection.modelId).toBe(
      'chat:latest'
    );
    tx.aiConversation.findFirst.mockResolvedValue({
      ...conversation([userMessage, { ...assistant, status: 'COMPLETED', modelId: 'original' }]),
      inheritsModel: true,
    });
    const replay = await conversationService.beginTurn('user-a', input);
    expect(replay.selection.modelId).toBe('original');
    expect(tx.userAiModelSetting.findMany).not.toHaveBeenCalled();
  });
  it('allows switching back to inheritance without a provider request, and rejects active generation', async () => {
    (prisma.aiConversation.findFirst as jest.Mock).mockResolvedValue({ id });
    (prisma.aiConversation.updateMany as jest.Mock)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await conversationService.changeModel('user-a', id, null);
    expect(resolveChatModel).not.toHaveBeenCalled();
    expect(prisma.aiConversation.updateMany).toHaveBeenCalledWith({
      where: { id, scope: 'ai-dev', userId: 'user-a', activeGenerationId: null },
      data: { inheritsModel: true },
    });
    await expect(
      conversationService.changeModel('user-a', id, { provider: 'ollama', modelId: 'other' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('denies switching another owner conversation before contacting the provider', async () => {
    (prisma.aiConversation.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(
      conversationService.changeModel('foreign', id, { provider: 'ollama', modelId: 'other' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(resolveChatModel).not.toHaveBeenCalled();
  });
});

describe('conversationService authorization', () => {
  it('scopes listing and deletion to the authenticated user', async () => {
    await conversationService.list('user-a');
    expect(prisma.aiConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-a', scope: 'ai-dev' } })
    );
    (prisma.aiConversation.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(conversationService.delete('user-a', id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(prisma.aiConversation.deleteMany).toHaveBeenCalledWith({
      where: { id, scope: 'ai-dev', userId: 'user-a' },
    });
  });
  it('does not expose conversations owned by another user', async () => {
    tx.aiConversation.updateMany.mockResolvedValue({ count: 0 });
    tx.aiConversation.findFirst.mockResolvedValue(null);
    await expect(conversationService.get('user-b', id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(conversationService.beginTurn('user-b', input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(tx.aiConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id, scope: 'ai-dev', userId: 'user-b' } })
    );
    expect(tx.aiMessage.create).not.toHaveBeenCalled();
  });
  it('validates model selection before creating a conversation', async () => {
    (resolveChatModel as jest.Mock).mockRejectedValue(new Error('invalid model'));
    await expect(
      conversationService.create('user-a', { provider: 'ollama', modelId: 'missing' })
    ).rejects.toThrow('invalid model');
    expect(prisma.aiConversation.create).not.toHaveBeenCalled();
  });
});

describe('conversationService turns', () => {
  it('saves a user message and placeholder response in order', async () => {
    const turn = await conversationService.beginTurn('user-a', input);
    expect(turn.history).toMatchObject([{ id: 'u', role: 'user' }]);
    expect(tx.aiMessage.create).toHaveBeenCalledTimes(2);
    expect(tx.aiMessage.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ conversationId: id, id: 'u', position: 0, role: 'user' }),
    });
    expect(tx.aiMessage.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        conversationId: id,
        position: 1,
        role: 'assistant',
        replyToId: 'u',
        status: 'GENERATING',
      }),
    });
    expect(tx.aiConversation.updateMany).toHaveBeenCalledWith({
      where: { id, scope: 'ai-dev', userId: 'user-a' },
      data: { title: 'Hello' },
    });
  });
  it('reuses the same rows on an interrupted-response retry', async () => {
    tx.aiConversation.findFirst.mockResolvedValue(conversation([userMessage, assistant]));
    const turn = await conversationService.beginTurn('user-a', input);
    expect(turn.response.id).toBe('a');
    expect(turn.history).toHaveLength(1);
    expect(tx.aiMessage.create).not.toHaveBeenCalled();
    expect(tx.aiMessage.update).toHaveBeenCalledWith({
      where: { conversationId_id: { conversationId: id, id: 'a' } },
      data: { parts: [], status: 'GENERATING', provider: 'ollama', modelId: 'chat:latest' },
    });
  });
  it('replays completed turns without creating messages', async () => {
    tx.aiConversation.findFirst.mockResolvedValue(
      conversation([userMessage, { ...assistant, status: 'COMPLETED' }])
    );
    const turn = await conversationService.beginTurn('user-a', input);
    expect(turn.generationId).toBeNull();
    expect(tx.aiMessage.create).not.toHaveBeenCalled();
    expect(tx.aiMessage.update).not.toHaveBeenCalled();
  });
  it('rejects a reused user ID with different content', async () => {
    tx.aiConversation.findFirst.mockResolvedValue(
      conversation([{ ...userMessage, parts: [{ type: 'text', text: 'Different' }] }])
    );
    await expect(conversationService.beginTurn('user-a', input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(tx.aiMessage.create).not.toHaveBeenCalled();
  });
  it('rejects concurrent generation for an owned conversation', async () => {
    tx.aiConversation.updateMany.mockResolvedValue({ count: 0 });
    await expect(conversationService.beginTurn('user-a', input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(tx.aiMessage.create).not.toHaveBeenCalled();
  });
  it('does not let an old retry rewrite a later turn', async () => {
    tx.aiConversation.findFirst.mockResolvedValue(
      conversation([userMessage, assistant, { ...userMessage, id: 'u2', position: 2 }])
    );
    await expect(conversationService.beginTurn('user-a', input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
  it('enforces context limits against stored history', async () => {
    tx.aiConversation.findFirst.mockResolvedValue(
      conversation(
        Array.from({ length: 5 }, (_, i) => ({
          ...userMessage,
          id: `old-${i}`,
          position: i,
          parts: [{ type: 'text', text: 'x'.repeat(16000) }],
        }))
      )
    );
    await expect(conversationService.beginTurn('user-a', input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
  it('recovers expired generations during an owner-scoped read', async () => {
    tx.aiConversation.findFirst.mockResolvedValue(conversation([userMessage, assistant]));
    const loaded = await conversationService.get('user-a', id);
    expect(loaded.lastResponseStatus).toBe('INTERRUPTED');
    expect(tx.aiMessage.updateMany).toHaveBeenCalledWith({
      where: { conversationId: id, conversation: { userId: 'user-a' }, status: 'GENERATING' },
      data: { status: 'INTERRUPTED' },
    });
    expect(tx.aiConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id,
          userId: 'user-a',
          generationStartedAt: { lt: expect.any(Date) },
        }),
      })
    );
  });
  it('does not recreate a deleted conversation or overwrite a newer generation', async () => {
    tx.aiConversation.updateMany.mockResolvedValue({ count: 0 });
    await conversationService.finishTurn(
      'user-a',
      id,
      'old-generation',
      { id: 'a', role: 'assistant', parts: [] },
      'COMPLETED'
    );
    expect(tx.aiMessage.updateMany).not.toHaveBeenCalled();
  });
  it('saves partial response parts and clears only the matching generation', async () => {
    const response = {
      id: 'a',
      role: 'assistant' as const,
      parts: [{ type: 'text' as const, text: 'Partial', state: 'streaming' as const }],
    };
    await conversationService.finishTurn('user-a', id, 'generation-1', response, 'INTERRUPTED');
    expect(tx.aiConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id, scope: 'ai-dev', userId: 'user-a', activeGenerationId: 'generation-1' },
      })
    );
    expect(tx.aiMessage.updateMany).toHaveBeenCalledWith({
      where: { conversationId: id, id: 'a', role: 'assistant', conversation: { userId: 'user-a' } },
      data: { parts: [{ type: 'text', text: 'Partial', state: 'done' }], status: 'INTERRUPTED' },
    });
  });
});

describe('Planner conversation isolation', () => {
  const planner = createConversationService('planner');
  it('scopes reads, model edits and deletion to Planner and owner', async () => {
    await planner.list('user-a');
    expect(prisma.aiConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-a', scope: 'planner' } })
    );
    (prisma.aiConversation.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(planner.changeModel('user-a', id, null)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(prisma.aiConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id, userId: 'user-a', scope: 'planner' } })
    );
    (prisma.aiConversation.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(planner.delete('user-a', id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.aiConversation.deleteMany).toHaveBeenCalledWith({
      where: { id, userId: 'user-a', scope: 'planner' },
    });
  });
  it('rejects an AI Dev conversation before writing a Planner message', async () => {
    tx.aiConversation.updateMany.mockResolvedValue({ count: 0 });
    tx.aiConversation.findFirst.mockResolvedValue(null);
    await expect(planner.beginTurn('user-a', input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(tx.aiConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-a', scope: 'planner' }),
      })
    );
    expect(tx.aiMessage.create).not.toHaveBeenCalled();
  });
});

describe('multimodal persistence and product association', () => {
  const productChat = createConversationService('nutrition-product');
  const image = { type: 'data-attachment' as const, data: { attachmentId: id } };
  it('retains images in the same transaction and restores ordered image-only history', async () => {
    const mixed = {
      ...input,
      message: {
        ...input.message,
        parts: [image, { type: 'text' as const, text: 'Label' }, image],
      },
    };
    const turn = await conversationService.beginTurn('user-a', mixed);
    expect(retainAttachments).toHaveBeenCalledWith(tx, 'user-a', [id, id]);
    expect(turn.history[0].parts).toEqual([
      image,
      { type: 'text', text: 'Label', state: 'done' },
      image,
    ]);
    tx.aiConversation.findFirst.mockResolvedValue(
      conversation([{ ...userMessage, parts: [image] }])
    );
    const next = await conversationService.beginTurn('user-a', {
      ...input,
      message: { ...input.message, id: 'followup' },
    });
    expect(next.history[0].parts).toEqual([image]);
  });
  it('does not persist messages when retention rejects a foreign/deleted upload', async () => {
    jest.mocked(retainAttachments).mockRejectedValue(new Error('Attachment not found.'));
    await expect(
      conversationService.beginTurn('user-a', {
        ...input,
        message: { ...input.message, parts: [image] },
      })
    ).rejects.toThrow('Attachment not found.');
    expect(tx.aiMessage.create).not.toHaveBeenCalled();
  });
  it('links an owned draft idempotently without rewriting any messages', async () => {
    tx.product.findFirst.mockResolvedValue({ id });
    await expect(productChat.linkProduct('user-a', id, id)).resolves.toEqual({ id, productId: id });
    expect(tx.aiConversation.updateMany).toHaveBeenCalledWith({
      where: {
        id,
        userId: 'user-a',
        scope: 'nutrition-product',
        OR: [{ productId: null }, { productId: id }],
      },
      data: { productId: id },
    });
    expect(tx.aiMessage.create).not.toHaveBeenCalled();
  });
  it('rejects foreign products, conversations and scopes', async () => {
    tx.product.findFirst.mockResolvedValue(null);
    await expect(productChat.linkProduct('user-a', id, id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(tx.aiConversation.updateMany).not.toHaveBeenCalled();
    tx.product.findFirst.mockResolvedValue({ id });
    tx.aiConversation.updateMany.mockResolvedValue({ count: 0 });
    await expect(productChat.linkProduct('user-a', id, id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(conversationService.linkProduct('user-a', id, id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('Product extraction stages and durable checkpoints', () => {
  const products = createConversationService('nutrition-product');
  const gemma = { provider: 'ollama' as const, modelId: 'gemma3:12b' };
  const qwen = { provider: 'ollama' as const, modelId: 'qwen3:8b' };
  const other = { provider: 'ollama' as const, modelId: 'qwen3:14b' };

  it('maps an older explicit model to transcription and independently inherits interpretation', async () => {
    const loaded = await products.get('user-a', id);
    expect(loaded.stageOverrides).toEqual({
      transcription: { provider: 'ollama', modelId: 'chat:latest' },
      interpretation: null,
    });
    expect(loaded.stageSelections?.interpretation.selection).toEqual(qwen);
    expect(loaded.override).toEqual(loaded.stageOverrides?.transcription);
  });

  it('restores both explicit selections after reload without changing historical attribution', async () => {
    tx.aiConversation.findFirst.mockResolvedValue({
      ...conversation([
        {
          ...assistant,
          modelId: gemma.modelId,
          provider: gemma.provider,
          modelSelections: { transcription: gemma, interpretation: qwen },
        },
      ]),
      inheritsModel: true,
      modelSelections: { transcription: gemma, interpretation: other },
    });
    const loaded = await products.get('user-a', id);
    expect(loaded.stageOverrides).toEqual({ transcription: gemma, interpretation: other });
    expect(loaded.stageSelections?.interpretation.selection).toEqual(other);
    expect(loaded.messages[0].metadata).toMatchObject({
      modelSelections: { transcription: gemma, interpretation: qwen },
    });
  });

  it('changes interpretation without resetting the transcription override', async () => {
    (prisma.aiConversation.findFirst as jest.Mock).mockResolvedValue({ id });
    tx.aiConversation.findFirst.mockResolvedValue({
      ...conversation(),
      modelSelections: { transcription: gemma, interpretation: qwen },
    });
    await products.changeStageModel('user-a', id, 'interpretation', other);
    expect(validateModelSelection).toHaveBeenCalledWith(other, ['chat']);
    expect(tx.aiConversation.updateMany).toHaveBeenLastCalledWith({
      where: { id, userId: 'user-a', scope: 'nutrition-product', activeGenerationId: null },
      data: { modelSelections: { transcription: gemma, interpretation: other } },
    });
  });

  it('restores transcription inheritance without resetting the interpretation override', async () => {
    (prisma.aiConversation.findFirst as jest.Mock).mockResolvedValue({ id });
    tx.aiConversation.findFirst.mockResolvedValue({
      ...conversation(),
      modelSelections: { transcription: gemma, interpretation: other },
    });
    await products.changeModel('user-a', id, null);
    expect(validateModelSelection).not.toHaveBeenCalled();
    expect(tx.aiConversation.updateMany).toHaveBeenLastCalledWith({
      where: { id, userId: 'user-a', scope: 'nutrition-product', activeGenerationId: null },
      data: {
        modelSelections: { transcription: null, interpretation: other },
        inheritsModel: true,
      },
    });
  });

  it('validates transcription capabilities and retains saved selections on rejection', async () => {
    (prisma.aiConversation.findFirst as jest.Mock).mockResolvedValue({ id });
    (validateModelSelection as jest.Mock).mockRejectedValue(new Error('Vision required'));
    await expect(products.changeStageModel('user-a', id, 'transcription', other)).rejects.toThrow(
      'Vision required'
    );
    expect(validateModelSelection).toHaveBeenCalledWith(other, ['chat', 'vision']);
    expect(tx.aiConversation.updateMany).not.toHaveBeenCalled();
  });

  it('resolves both models from one settings snapshot before persisting response attribution', async () => {
    tx.aiConversation.findFirst.mockResolvedValue({ ...conversation(), inheritsModel: true });
    tx.userAiModelSetting.findMany.mockResolvedValue([
      { key: 'nutrition.productImport', value: gemma },
      { key: 'nutrition.productInterpretation', value: other },
    ]);
    const turn = await products.beginTurn('user-a', input);
    expect(tx.userAiModelSetting.findMany).toHaveBeenCalledTimes(1);
    expect(turn.stageSelections).toEqual({ transcription: gemma, interpretation: other });
    expect(turn.response.metadata).toMatchObject({ modelSelections: turn.stageSelections });
    expect(tx.aiMessage.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ modelSelections: turn.stageSelections }),
    });
  });

  it('reuses a saved checkpoint from a failed latest response and earlier successful turns', async () => {
    const checkpoint = { evidence: { text: 'private label' }, fingerprint: 'photos-v1' };
    tx.aiConversation.findFirst.mockResolvedValue(
      conversation([
        userMessage,
        { ...assistant, status: 'FAILED', pipelineCheckpoint: checkpoint },
      ])
    );
    expect((await products.beginTurn('user-a', input)).checkpoint).toEqual(checkpoint);
    tx.aiConversation.findFirst.mockResolvedValue(
      conversation([
        { ...assistant, replyToId: 'earlier', status: 'COMPLETED', pipelineCheckpoint: checkpoint },
      ])
    );
    expect((await products.beginTurn('user-a', input)).checkpoint).toEqual(checkpoint);
  });

  it('fences checkpoint writes and retains them independently when finishing a failed turn', async () => {
    const checkpoint = { version: 'v1', evidence: { cells: [] } };
    tx.aiMessage.updateMany.mockResolvedValue({ count: 1 });
    await products.saveCheckpoint('user-a', id, 'generation-1', 'a', checkpoint);
    expect(tx.aiMessage.updateMany).toHaveBeenLastCalledWith({
      where: {
        conversationId: id,
        id: 'a',
        role: 'assistant',
        status: 'GENERATING',
        conversation: { userId: 'user-a' },
      },
      data: { pipelineCheckpoint: checkpoint },
    });
    await products.finishTurn(
      'user-a',
      id,
      'generation-1',
      { id: 'a', role: 'assistant', parts: [] },
      'FAILED'
    );
    expect(tx.aiMessage.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { parts: [], status: 'FAILED' } })
    );
    tx.aiConversation.updateMany.mockResolvedValue({ count: 0 });
    tx.aiMessage.updateMany.mockClear();
    await expect(
      products.saveCheckpoint('user-a', id, 'old-generation', 'a', checkpoint)
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(tx.aiMessage.updateMany).not.toHaveBeenCalled();
  });

  it('bounds checkpoint storage before writing and rejects unsupported checkpoint values', async () => {
    await expect(
      products.saveCheckpoint('user-a', id, 'generation', 'a', { output: 'x'.repeat(1_048_576) })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      products.saveCheckpoint('user-a', id, 'generation', 'a', { output: undefined })
    ).rejects.toThrow();
    expect(tx.aiConversation.updateMany).not.toHaveBeenCalled();
  });

  it('replays the original stage snapshots even after settings have changed', async () => {
    tx.aiConversation.findFirst.mockResolvedValue({
      ...conversation([
        userMessage,
        {
          ...assistant,
          status: 'COMPLETED',
          modelId: gemma.modelId,
          modelSelections: { transcription: gemma, interpretation: qwen },
        },
      ]),
      modelSelections: { transcription: gemma, interpretation: other },
    });
    const turn = await products.beginTurn('user-a', input);
    expect(turn.generationId).toBeNull();
    expect(turn.stageSelections).toEqual({ transcription: gemma, interpretation: qwen });
    expect(tx.userAiModelSetting.findMany).not.toHaveBeenCalled();
  });
});

describe('Durable safe stage failure summaries', () => {
  const products = createConversationService('nutrition-product');
  it.each(['FAILED', 'INTERRUPTED'])(
    'restores the latest %s stage failure without exposing private payloads',
    async (status) => {
      tx.aiConversation.findFirst.mockResolvedValue(
        conversation([
          {
            ...assistant,
            status,
            pipelineCheckpoint: {
              evidence: { private: 'photographed source content' },
              lastFailure: {
                stage: 'interpretation',
                message: 'Private provider error must not reach the client',
                diagnostics: { output: 'private output' },
              },
            },
          },
        ])
      );
      const loaded = await products.get('user-a', id);
      expect(loaded.lastStageFailure).toEqual({
        stage: 'interpretation',
        label: 'Text interpretation',
        message: 'Text interpretation failed. Check the selected model and retry.',
      });
      expect(JSON.stringify(loaded.lastStageFailure)).not.toContain('private');
    }
  );
  it('reports transcription failures independently of interpretation failures', async () => {
    tx.aiConversation.findFirst.mockResolvedValue(
      conversation([
        {
          ...assistant,
          status: 'FAILED',
          pipelineCheckpoint: { lastFailure: { stage: 'transcription', message: 'safe' } },
        },
      ])
    );
    expect((await products.get('user-a', id)).lastStageFailure).toEqual({
      stage: 'transcription',
      label: 'Vision transcription',
      message: 'Vision transcription failed. Check the selected model and retry.',
    });
  });
  it.each([
    {
      status: 'COMPLETED',
      pipelineCheckpoint: { lastFailure: { stage: 'transcription', message: 'safe' } },
    },
    {
      status: 'GENERATING',
      pipelineCheckpoint: { lastFailure: { stage: 'transcription', message: 'safe' } },
    },
    { status: 'FAILED', pipelineCheckpoint: null },
    {
      status: 'FAILED',
      pipelineCheckpoint: { lastFailure: { stage: 'unknown', message: 'safe' } },
    },
    { status: 'FAILED', pipelineCheckpoint: { lastFailure: { stage: 'interpretation' } } },
    {
      status: 'FAILED',
      pipelineCheckpoint: { lastFailure: { stage: 'interpretation', message: 'x'.repeat(501) } },
    },
  ])('ignores absent, malformed or inactive failure metadata: %j', async (fields) => {
    tx.aiConversation.updateMany.mockResolvedValue({ count: 0 });
    tx.aiConversation.findFirst.mockResolvedValue(conversation([{ ...assistant, ...fields }]));
    expect((await products.get('user-a', id)).lastStageFailure).toBeNull();
  });
  it('does not surface an older failure after a later completed response', async () => {
    tx.aiConversation.findFirst.mockResolvedValue(
      conversation([
        {
          ...assistant,
          status: 'FAILED',
          pipelineCheckpoint: { lastFailure: { stage: 'transcription', message: 'safe' } },
        },
        { ...assistant, id: 'later', status: 'COMPLETED', position: 2 },
      ])
    );
    expect((await products.get('user-a', id)).lastStageFailure).toBeNull();
  });
});

describe('Nutrition photo reference quotas on changed-configuration retries', () => {
  const photos = Array.from(
    { length: 8 },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
  );
  const history = Array.from({ length: 3 }, (_, position) => ({
    ...userMessage,
    id: `photo-user-${position}`,
    position,
    parts: photos.map((id) => ({ type: 'data-attachment', data: { attachmentId: id } })),
  }));
  it('allows repeated references to the same photos in Nutrition without increasing its unique image quota', async () => {
    tx.aiConversation.findFirst.mockResolvedValue(conversation(history));
    const turn = await createConversationService('nutrition-product').beginTurn('user-a', input);
    expect(turn.history).toHaveLength(4);
    expect(retainAttachments).toHaveBeenCalled();
  });
  it('continues limiting repeated image references in generic chat', async () => {
    tx.aiConversation.findFirst.mockResolvedValue(conversation(history));
    await expect(conversationService.beginTurn('user-a', input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(retainAttachments).not.toHaveBeenCalled();
  });
  it('still rejects more than the allowed unique photographs in Nutrition', async () => {
    const tooMany = history.map((message, messageIndex) => ({
      ...message,
      parts: message.parts.map((part, photoIndex) => ({
        ...part,
        data: {
          attachmentId: `00000000-0000-4000-8000-${String(messageIndex * 8 + photoIndex).padStart(12, '0')}`,
        },
      })),
    }));
    tx.aiConversation.findFirst.mockResolvedValue(conversation(tooMany));
    await expect(
      createConversationService('nutrition-product').beginTurn('user-a', input)
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(retainAttachments).not.toHaveBeenCalled();
  });
});
