/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    aiConversation: { findMany: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
  },
}));
jest.mock('@/lib/ai', () => ({ resolveChatModel: jest.fn() }));

import { prisma } from '@/lib/prisma';
import { resolveChatModel } from '@/lib/ai';
import { conversationService } from './conversations';
import type { ChatInput } from './schema';

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
});

describe('conversationService authorization', () => {
  it('scopes listing and deletion to the authenticated user', async () => {
    await conversationService.list('user-a');
    expect(prisma.aiConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-a' } })
    );
    (prisma.aiConversation.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(conversationService.delete('user-a', id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(prisma.aiConversation.deleteMany).toHaveBeenCalledWith({
      where: { id, userId: 'user-a' },
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
      expect.objectContaining({ where: { id, userId: 'user-b' } })
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
      where: { id, userId: 'user-a' },
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
      data: { parts: [], status: 'GENERATING' },
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
        where: { id, userId: 'user-a', activeGenerationId: 'generation-1' },
      })
    );
    expect(tx.aiMessage.updateMany).toHaveBeenCalledWith({
      where: { conversationId: id, id: 'a', role: 'assistant', conversation: { userId: 'user-a' } },
      data: { parts: [{ type: 'text', text: 'Partial', state: 'done' }], status: 'INTERRUPTED' },
    });
  });
});
