import 'server-only';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { applyRecord, previewRecord, recordContext } from '../conversation/records';
import { locked } from '../conversation/transaction';
import { Clarification, conflict, findMatches } from '../conversation/resolve';
import { recordPreviewSchema, type Instruction } from '../conversation/schema';
import { fingerprint } from '../proposals/snapshot';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
async function authorize(tx: Prisma.TransactionClient, userId: string, conversationId: string) {
  const conversation = await tx.aiConversation.findFirst({
    where: { id: conversationId, userId, scope: 'planner' },
  });
  if (!conversation) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Planner conversation not found.' });
  }
  return conversation;
}
async function transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  return locked(async (tx) => {
    // Preserve the proposal/record service lock order, then serialize preview lifecycle.
    await tx.$executeRaw`LOCK TABLE "ai_conversations", "planner_record_proposals" IN SHARE ROW EXCLUSIVE MODE`;
    return operation(tx);
  });
}
const view = (row: { id: string; status: string; preview: unknown; receipt: unknown }) => ({
  id: row.id,
  status: row.status,
  preview: recordPreviewSchema.parse(row.preview),
  accepted: Boolean(row.receipt),
});
export const workspaceRecords = {
  async pending(userId: string, conversationId: string) {
    await authorize(prisma, userId, conversationId);
    const row = await prisma.plannerRecordProposal.findFirst({
      where: { conversationId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    return row ? view(row) : null;
  },
  async get(userId: string, conversationId: string, id: string) {
    await authorize(prisma, userId, conversationId);
    const row = await prisma.plannerRecordProposal.findFirst({ where: { id, conversationId } });
    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Record preview not found.' });
    }
    const context = row.status === 'PENDING' ? await recordContext(prisma, userId) : null;
    return {
      ...view(row),
      stale: context !== null && context.hash !== recordPreviewSchema.parse(row.preview).baseHash,
    };
  },
  async find(userId: string, conversationId: string, entity: 'task' | 'theme', query: string) {
    await authorize(prisma, userId, conversationId);
    const context = await recordContext(prisma, userId);
    const pool =
      entity === 'task'
        ? context.tasks.map((t) => ({
            id: t.id,
            label: t.title,
            status: t.status,
            themeId: t.themeId,
          }))
        : context.themes.map((t) => ({ id: t.id, label: t.name }));
    const matches = findMatches(pool, query);
    return {
      matches: matches.slice(0, 30),
      reply: `${matches.length} matching ${entity} records${matches.length > 30 ? ' (first 30 shown)' : ''}. Use an exact ID when names repeat.`,
    };
  },
  async propose(
    userId: string,
    conversationId: string,
    id: string,
    instruction: Extract<Instruction, { type: 'record' }>,
    messageId: string,
    revise = false
  ) {
    return transaction(async (tx) => {
      await authorize(tx, userId, conversationId);
      const inputHash = fingerprint({ conversationId, instruction, revise });
      const saved = await tx.plannerRecordProposal.findUnique({ where: { id } });
      if (saved) {
        if (saved.conversationId !== conversationId || saved.inputHash !== inputHash) {
          throw conflict('This request ID was used for another record preview.');
        }
        return view(saved);
      }
      const latestMessage = await tx.aiMessage.findFirst({
        where: { conversationId, role: 'user' },
        orderBy: { position: 'desc' },
        select: { id: true },
      });
      if (latestMessage?.id !== messageId) {
        throw conflict('This turn is no longer current. Send a new message.');
      }
      const previous = await tx.plannerRecordProposal.findFirst({
        where: { conversationId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
      const context = await recordContext(tx, userId);
      let resolvedInstruction = instruction;
      if (revise) {
        if (!previous) {
          throw new Clarification('There is no pending record preview to revise.');
        }
        const pending = recordPreviewSchema.parse(previous.preview);
        resolvedInstruction = {
          ...instruction,
          entity: pending.entity,
          action: pending.action,
          query: pending.id,
        };
        if (pending.action === 'delete') {
          throw new Clarification(
            'Discard the deletion preview before requesting a different change.'
          );
        }
      }
      const preview = previewRecord(
        context,
        resolvedInstruction,
        previous ? recordPreviewSchema.parse(previous.preview) : undefined
      );
      // Bound model-authored descriptions before persistence; all other patch limits reuse the normal API.
      if (JSON.stringify(preview).length > 32000) {
        throw new Clarification(
          'This record is too large for a chat preview. Use the regular editor.'
        );
      }
      await tx.plannerRecordProposal.updateMany({
        where: { conversationId, status: 'PENDING' },
        data: { status: 'SUPERSEDED' },
      });
      return view(
        await tx.plannerRecordProposal.create({
          data: { id, conversationId, inputHash, preview: json(preview) },
        })
      );
    });
  },
  async resolve(
    userId: string,
    conversationId: string,
    id: string,
    action: 'accept' | 'discard',
    confirmDeletion = false
  ) {
    return transaction(async (tx) => {
      const conversation = await authorize(tx, userId, conversationId);
      const row = await tx.plannerRecordProposal.findFirst({ where: { id, conversationId } });
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Record preview not found.' });
      }
      if (action === 'accept' && row.receipt) {
        return view(row);
      }
      if (row.status === 'DISCARDED' && action === 'discard') {
        return view(row);
      }
      if (row.status !== 'PENDING') {
        throw conflict('This preview is no longer pending.');
      }
      if (
        conversation.activeGenerationId &&
        conversation.generationStartedAt &&
        conversation.generationStartedAt.getTime() > Date.now() - 180000
      ) {
        throw conflict('Wait for the response to finish before resolving a preview.');
      }
      const receipt =
        action === 'accept'
          ? await applyRecord(tx, userId, recordPreviewSchema.parse(row.preview), confirmDeletion)
          : undefined;
      return view(
        await tx.plannerRecordProposal.update({
          where: { id },
          data: {
            status: action === 'accept' ? 'ACCEPTED' : 'DISCARDED',
            ...(receipt ? { receipt: json(receipt) } : {}),
          },
        })
      );
    });
  },
};
