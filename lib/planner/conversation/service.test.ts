/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: { $transaction: jest.fn(), plannerConversation: { findFirst: jest.fn() } },
}));
jest.mock('@/lib/ai', () => ({ validateModelSelection: jest.fn() }));
jest.mock('@/lib/ai/structured', () => ({ generateStructured: jest.fn() }));
jest.mock('@/lib/model-settings/service', () => ({ requireModelSelection: jest.fn() }));
jest.mock('../proposals/service', () => ({ proposalService: { context: jest.fn() } }));
jest.mock('./planning', () => ({ planInstruction: jest.fn() }));
jest.mock('./records', () => ({
  recordContext: jest.fn(),
  previewRecord: jest.fn(),
  applyRecord: jest.fn(),
}));
import { prisma } from '@/lib/prisma';
import { generateStructured } from '@/lib/ai/structured';
import { validateModelSelection } from '@/lib/ai';
import { AiError } from '@/lib/ai/errors';
import { Prisma } from '@/generated/prisma/client';
import { requireModelSelection } from '@/lib/model-settings/service';
import { proposalService } from '../proposals/service';
import { recordContext, previewRecord, applyRecord } from './records';
import { conversationService } from './service';
import { fingerprint } from '../proposals/snapshot';
import { Clarification } from './resolve';
import type { ConversationResult } from './schema';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = {
  conversationId: id(1),
  requestId: id(2),
  revision: 0,
  date: '2026-10-20',
  text: 'Create a task called Report',
};
const model = { provider: 'ollama' as const, modelId: 'fixture' };
const instruction = {
  type: 'record' as const,
  entity: 'task' as const,
  action: 'create' as const,
  query: null,
  task: { title: 'Report' },
  theme: null,
};
const preview = {
  entity: 'task' as const,
  action: 'create' as const,
  id: null,
  baseHash: 'hash',
  before: null,
  patch: { title: 'Report' },
  warnings: [],
};
const result: ConversationResult = {
  reply: 'Review',
  date: input.date,
  timezone: 'Europe/Amsterdam',
  model,
  instruction,
  record: preview,
};
const tx = {
  $executeRaw: jest.fn(),
  user: { findUniqueOrThrow: jest.fn() },
  plannerConversation: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  plannerConversationTurn: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  planningProposal: { findFirst: jest.fn(), updateMany: jest.fn() },
};
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(tx));
  tx.plannerConversation.findFirst.mockResolvedValue({
    id: id(1),
    userId: 'owner',
    revision: 0,
    activeTurnId: null,
  });
  tx.plannerConversation.updateMany.mockResolvedValue({ count: 1 });
  tx.user.findUniqueOrThrow.mockResolvedValue({ timezone: 'Europe/Amsterdam' });
  tx.plannerConversationTurn.findMany.mockResolvedValue([]);
  jest.mocked(recordContext).mockResolvedValue({ tasks: [], themes: [] } as any);
  jest.mocked(requireModelSelection).mockResolvedValue(model);
  jest
    .mocked(generateStructured)
    .mockImplementation(async ({ schema }) =>
      schema.safeParse({ scope: 'records' }).success ? { scope: 'records' } : instruction
    );
  jest.mocked(previewRecord).mockReturnValue(preview);
  jest.mocked(proposalService.context).mockResolvedValue({
    timezone: 'Europe/Amsterdam',
    blocks: [],
    candidates: [],
    baseHash: 'hash',
  });
  jest
    .mocked(prisma.plannerConversation.findFirst)
    .mockResolvedValue({ id: id(1), revision: 1, turns: [] } as any);
});
it('persists only the instruction preview, with model attribution and a fenced lease', async () => {
  await conversationService.send('owner', input);
  expect(applyRecord).not.toHaveBeenCalled();
  expect(tx.plannerConversationTurn.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: 'PREVIEW',
        result: expect.objectContaining({ record: preview, model }),
      }),
    })
  );
  expect(tx.plannerConversation.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        userId: 'owner',
        revision: 1,
        activeTurnId: expect.any(String),
        leaseExpiresAt: { gt: expect.any(Date) },
      }),
    })
  );
});
it('replays a completed request before resolving a model and rejects changed retry text', async () => {
  tx.plannerConversationTurn.findUnique.mockResolvedValue({
    conversationId: id(1),
    inputHash: fingerprint(input),
    result,
  });
  await conversationService.send('owner', input);
  expect(generateStructured).not.toHaveBeenCalled();
  expect(requireModelSelection).not.toHaveBeenCalled();
  await expect(
    conversationService.send('owner', { ...input, text: 'Different request' })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('rejects foreign ownership before resolving records and prevents concurrent turns', async () => {
  tx.plannerConversation.findFirst.mockResolvedValueOnce(null);
  await expect(conversationService.send('other', input)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  expect(recordContext).not.toHaveBeenCalled();
  tx.plannerConversation.findFirst.mockResolvedValue({
    id: id(1),
    revision: 0,
    activeTurnId: id(9),
    leaseExpiresAt: new Date(Date.now() + 60000),
  });
  await expect(conversationService.send('owner', input)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  expect(generateStructured).not.toHaveBeenCalled();
});
it('rejects stale conversation revisions and a reply that lost its generation lease', async () => {
  await expect(conversationService.send('owner', { ...input, revision: 2 })).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  tx.plannerConversation.updateMany.mockResolvedValue({ count: 0 });
  await expect(conversationService.send('owner', input)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  expect(tx.plannerConversationTurn.update).not.toHaveBeenCalled();
});
it('keeps the earlier pending preview through ambiguity and passes it into corrections', async () => {
  tx.plannerConversationTurn.findFirst.mockResolvedValue({ result });
  jest.mocked(previewRecord).mockImplementation(() => {
    throw new Clarification('Which theme?', [{ id: id(4), label: 'Work' }]);
  });
  await conversationService.send('owner', input);
  expect(previewRecord).toHaveBeenCalledWith(expect.anything(), instruction, preview);
  expect(tx.plannerConversationTurn.updateMany).not.toHaveBeenCalled();
  expect(tx.plannerConversationTurn.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: {
        status: 'READY',
        result: expect.objectContaining({
          reply: 'Which theme?',
          instruction: { type: 'clarify', question: 'Which theme?' },
        }),
      },
    })
  );
});
it('clears failed generations without mutations, allowing the same request to retry', async () => {
  jest.mocked(generateStructured).mockRejectedValue(new Error('Provider disconnected'));
  await expect(conversationService.send('owner', input)).rejects.toThrow('Provider disconnected');
  expect(tx.plannerConversationTurn.update).toHaveBeenCalledWith({
    where: { id: id(2) },
    data: { status: 'FAILED' },
  });
  expect(applyRecord).not.toHaveBeenCalled();
});
it('accepts once with a durable receipt and replays it without creating another record', async () => {
  tx.plannerConversationTurn.findFirst.mockResolvedValue({ id: id(2), status: 'PREVIEW', result });
  jest.mocked(applyRecord).mockResolvedValue({ id: id(3) });
  const acceptance = { conversationId: id(1), turnId: id(2) };
  expect(await conversationService.accept('owner', acceptance)).toEqual({ id: id(3) });
  expect(applyRecord).toHaveBeenCalledWith(tx, 'owner', preview, false);
  expect(tx.plannerConversationTurn.update).toHaveBeenCalledWith({
    where: { id: id(2) },
    data: { status: 'ACCEPTED', receipt: { id: id(3) } },
  });
  tx.plannerConversationTurn.findFirst.mockResolvedValue({ id: id(2), receipt: { id: id(3) } });
  await conversationService.accept('owner', acceptance);
  expect(applyRecord).toHaveBeenCalledTimes(1);
});
it('cannot accept superseded previews or during a new generation', async () => {
  tx.plannerConversationTurn.findFirst.mockResolvedValue({
    id: id(2),
    status: 'SUPERSEDED',
    result,
  });
  await expect(
    conversationService.accept('owner', { conversationId: id(1), turnId: id(2) })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  tx.plannerConversationTurn.findFirst.mockResolvedValue({ id: id(2), status: 'PREVIEW', result });
  tx.plannerConversation.findFirst.mockResolvedValue({ id: id(1), activeTurnId: id(8) });
  await expect(
    conversationService.accept('owner', { conversationId: id(1), turnId: id(2) })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(applyRecord).not.toHaveBeenCalled();
});
it('surfaces receipt persistence failures instead of acknowledging incomplete acceptance', async () => {
  tx.plannerConversationTurn.findFirst.mockResolvedValue({ id: id(2), status: 'PREVIEW', result });
  jest.mocked(applyRecord).mockResolvedValue({ id: id(3) });
  tx.plannerConversationTurn.update.mockRejectedValue(new Error('receipt failed'));
  await expect(
    conversationService.accept('owner', { conversationId: id(1), turnId: id(2) })
  ).rejects.toThrow('receipt failed');
});
it('discards a preview explicitly without touching tasks', async () => {
  tx.plannerConversationTurn.findFirst.mockResolvedValue({ id: id(2), result });
  await conversationService.discard('owner', { conversationId: id(1), turnId: id(2) });
  expect(tx.plannerConversationTurn.update).toHaveBeenCalledWith({
    where: { id: id(2) },
    data: { status: 'DISCARDED' },
  });
  expect(applyRecord).not.toHaveBeenCalled();
});

it('uses the conversation override captured with the generation lease', async () => {
  const selection = { provider: 'ollama', modelId: 'conversation:latest' };
  tx.plannerConversation.findFirst.mockResolvedValue({
    id: id(1),
    userId: 'owner',
    revision: 0,
    modelOverride: selection,
  });
  await conversationService.send('owner', input);
  expect(requireModelSelection).toHaveBeenCalledWith('owner', 'planner.conversation', selection);
});

it('persists a model override with a revision change and returns it on reload', async () => {
  const selection = { provider: 'ollama' as const, modelId: 'conversation:latest' };
  jest
    .mocked(prisma.plannerConversation.findFirst)
    .mockResolvedValue({ id: id(1), revision: 1, modelOverride: selection, turns: [] } as any);
  const result = await conversationService.changeModel('owner', {
    conversationId: id(1),
    revision: 0,
    selection,
  });
  expect(tx.plannerConversation.update).toHaveBeenCalledWith({
    where: { id: id(1) },
    data: { modelOverride: selection, revision: { increment: 1 } },
  });
  expect(result.override).toEqual(selection);
});

it('allows returning to settings and fences stale or busy model changes', async () => {
  await conversationService.changeModel('owner', {
    conversationId: id(1),
    revision: 0,
    selection: null,
  });
  expect(tx.plannerConversation.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        modelOverride: Prisma.DbNull,
        revision: { increment: 1 },
      }),
    })
  );
  tx.plannerConversation.update.mockClear();
  await expect(
    conversationService.changeModel('owner', {
      conversationId: id(1),
      revision: 2,
      selection: null,
    })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  tx.plannerConversation.findFirst.mockResolvedValue({
    id: id(1),
    revision: 0,
    activeTurnId: id(9),
    leaseExpiresAt: new Date(Date.now() + 60000),
  });
  await expect(
    conversationService.changeModel('owner', {
      conversationId: id(1),
      revision: 0,
      selection: null,
    })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(tx.plannerConversation.update).not.toHaveBeenCalled();
});

it('rejects model changes for another owner and invalid selections', async () => {
  jest.mocked(prisma.plannerConversation.findFirst).mockResolvedValue(null);
  await expect(
    conversationService.changeModel('other', {
      conversationId: id(1),
      revision: 0,
      selection: null,
    })
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    conversationService.changeModel('owner', {
      conversationId: id(1),
      revision: 0,
      selection: { provider: 'ollama', modelId: '' },
    })
  ).rejects.toThrow();
  expect(tx.plannerConversation.update).not.toHaveBeenCalled();
});

it('rejects unavailable or incompatible model selections before persisting changes', async () => {
  jest
    .mocked(validateModelSelection)
    .mockRejectedValue(new AiError('MODEL_NOT_FOUND', 'Choose an installed chat model.'));
  await expect(
    conversationService.changeModel('owner', {
      conversationId: id(1),
      revision: 0,
      selection: model,
    })
  ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Choose an installed chat model.' });
  expect(validateModelSelection).toHaveBeenCalledWith(model, ['chat']);
  expect(tx.plannerConversation.update).not.toHaveBeenCalled();
});
