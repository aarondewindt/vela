import 'server-only';

import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import type { UIMessage } from 'ai';
import { prisma } from '@/lib/prisma';
import { resolveChatModel, type AiModelSelection } from '@/lib/ai';
import { selectionSchema, storedPartsSchema, type ChatInput } from './schema';
import { effectiveModel, requireModelSelection } from '@/lib/model-settings/service';

const generationLeaseMs = 180_000;
export type ResponseStatus = 'COMPLETED' | 'INTERRUPTED' | 'FAILED';

function partsForStorage(value: unknown) {
  return storedPartsSchema
    .parse(value)
    .map((part) =>
      part.type === 'text'
        ? { type: 'text' as const, text: part.text, state: 'done' as const }
        : { type: 'step-start' as const }
    );
}

function asMessage(row: {
  id: string;
  role: 'user' | 'assistant';
  parts: unknown;
  provider?: string | null;
  modelId?: string | null;
}): UIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: partsForStorage(row.parts),
    ...(row.modelId ? { metadata: { provider: row.provider, modelId: row.modelId } } : {}),
  };
}

function notFound(): never {
  throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found.' });
}

export function createConversationService(scope: 'ai-dev' | 'planner' = 'ai-dev') {
  const feature = scope === 'planner' ? 'planner.conversation' : 'aiDev.chat';
  return {
    list(userId: string) {
      return prisma.aiConversation.findMany({
        where: { userId, scope },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          title: true,
          provider: true,
          modelId: true,
          inheritsModel: true,
          updatedAt: true,
        },
      });
    },

    async create(userId: string, override: AiModelSelection | null = null) {
      const selection = await requireModelSelection(userId, feature, override);
      await resolveChatModel(selection);
      return prisma.aiConversation.create({
        data: {
          userId,
          scope,
          provider: selection.provider,
          modelId: selection.modelId,
          inheritsModel: !override,
        },
        select: { id: true },
      });
    },

    async changeModel(userId: string, id: string, override: AiModelSelection | null) {
      const existing = await prisma.aiConversation.findFirst({
        where: { id, userId, scope },
        select: { id: true },
      });
      if (!existing) {
        return notFound();
      }
      if (override) {
        await resolveChatModel(override);
      }
      const changed = await prisma.aiConversation.updateMany({
        where: { id, userId, scope, activeGenerationId: null },
        data: {
          inheritsModel: !override,
          ...(override ? { provider: override.provider, modelId: override.modelId } : {}),
        },
      });
      if (!changed.count) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Wait for the active response to finish, then reload before changing models.',
        });
      }
      return { updated: true };
    },

    async get(userId: string, id: string) {
      return prisma.$transaction(async (tx) => {
        const expired = await tx.aiConversation.updateMany({
          where: {
            id,
            userId,
            scope,
            activeGenerationId: { not: null },
            generationStartedAt: { lt: new Date(Date.now() - generationLeaseMs) },
          },
          data: { activeGenerationId: null, generationStartedAt: null },
        });
        if (expired.count) {
          await tx.aiMessage.updateMany({
            where: { conversationId: id, conversation: { userId }, status: 'GENERATING' },
            data: { status: 'INTERRUPTED' },
          });
        }
        const conversation = await tx.aiConversation.findFirst({
          where: { id, userId, scope },
          include: { messages: { orderBy: { position: 'asc' } } },
        });
        if (!conversation) {
          return notFound();
        }
        return {
          id: conversation.id,
          title: conversation.title,
          override: conversation.inheritsModel
            ? null
            : selectionSchema.parse({
                provider: conversation.provider,
                modelId: conversation.modelId,
              }),
          ...(await effectiveModel(
            userId,
            feature,
            conversation.inheritsModel
              ? null
              : selectionSchema.parse({
                  provider: conversation.provider,
                  modelId: conversation.modelId,
                }),
            tx
          )),
          updatedAt: conversation.updatedAt,
          generating: conversation.activeGenerationId !== null,
          messages: conversation.messages.map(asMessage),
          lastResponseStatus:
            conversation.messages.filter((message) => message.role === 'assistant').at(-1)
              ?.status ?? null,
        };
      });
    },

    async delete(userId: string, id: string) {
      const result = await prisma.aiConversation.deleteMany({ where: { id, userId, scope } });
      if (!result.count) {
        return notFound();
      }
      return { deleted: true };
    },

    async beginTurn(userId: string, input: ChatInput) {
      const generationId = randomUUID();
      const conversationId = input.conversationId;
      const parts = partsForStorage(input.message.parts);
      return prisma.$transaction(async (tx) => {
        // This conditional write locks the conversation row for the short transaction.
        const claimed = await tx.aiConversation.updateMany({
          where: {
            id: conversationId,
            userId,
            scope,
            OR: [
              { activeGenerationId: null },
              { generationStartedAt: { lt: new Date(Date.now() - generationLeaseMs) } },
            ],
          },
          data: { activeGenerationId: generationId, generationStartedAt: new Date() },
        });
        if (!claimed.count) {
          const owned = await tx.aiConversation.findFirst({
            where: { id: conversationId, userId, scope },
            select: { id: true },
          });
          if (!owned) {
            return notFound();
          }
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A response is already being generated. Wait for it to finish, then retry.',
          });
        }
        await tx.aiMessage.updateMany({
          where: { conversationId, conversation: { userId }, status: 'GENERATING' },
          data: { status: 'INTERRUPTED' },
        });
        const conversation = await tx.aiConversation.findFirst({
          where: { id: conversationId, userId, scope },
          include: { messages: { orderBy: { position: 'asc' } } },
        });
        if (!conversation) {
          return notFound();
        }
        const existing = conversation.messages.find((message) => message.id === input.message.id);
        if (
          existing &&
          (existing.role !== 'user' ||
            JSON.stringify(partsForStorage(existing.parts)) !== JSON.stringify(parts))
        ) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'This message ID has already been used for different content. Reload the conversation.',
          });
        }
        const previousReply =
          existing && conversation.messages.find((message) => message.replyToId === existing.id);
        if (previousReply?.status === 'COMPLETED') {
          await tx.aiConversation.updateMany({
            where: { id: conversationId, userId, scope, activeGenerationId: generationId },
            data: { activeGenerationId: null, generationStartedAt: null },
          });
          return {
            selection: {
              provider: 'ollama' as const,
              modelId: previousReply.modelId ?? conversation.modelId,
            },
            history: [] as UIMessage[],
            response: asMessage(previousReply),
            generationId: null,
          };
        }
        if (
          existing &&
          conversation.messages.some(
            (message) => message.role === 'user' && message.position > existing.position
          )
        ) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'Only the latest interrupted response can be retried. Reload the conversation.',
          });
        }
        const selection = await requireModelSelection(
          userId,
          feature,
          conversation.inheritsModel
            ? null
            : {
                provider: 'ollama',
                modelId: conversation.modelId,
              },
          tx
        );
        const history = conversation.messages
          .filter((message) => message.role === 'user' || message.status !== 'FAILED')
          .filter((message) => !previousReply || message.id !== previousReply.id)
          .map(asMessage)
          .filter((message) =>
            message.parts.some((part) => part.type === 'text' && part.text.trim())
          );
        if (!existing) {
          history.push({ ...input.message, parts });
        }
        const characters = history.reduce(
          (total, message) =>
            total +
            message.parts.reduce(
              (sum, part) => sum + (part.type === 'text' ? part.text.length : 0),
              0
            ),
          0
        );
        if (history.length > 100 || characters > 64_000) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This conversation is too long. Start a new conversation to continue.',
          });
        }
        const position = (conversation.messages.at(-1)?.position ?? -1) + 1;
        if (!existing) {
          await tx.aiMessage.create({
            data: { conversationId, id: input.message.id, role: 'user', parts, position },
          });
        }
        const assistant = previousReply
          ? await tx.aiMessage.update({
              where: { conversationId_id: { conversationId, id: previousReply.id } },
              data: {
                parts: [],
                status: 'GENERATING',
                provider: selection.provider,
                modelId: selection.modelId,
              },
            })
          : await tx.aiMessage.create({
              data: {
                conversationId,
                id: randomUUID(),
                role: 'assistant',
                parts: [],
                position: position + 1,
                replyToId: input.message.id,
                status: 'GENERATING',
                provider: selection.provider,
                modelId: selection.modelId,
              },
            });
        if (conversation.messages.length === 0) {
          const title = parts
            .map((part) => (part.type === 'text' ? part.text : ''))
            .join(' ')
            .trim()
            .slice(0, 80);
          await tx.aiConversation.updateMany({
            where: { id: conversationId, userId, scope },
            data: { title },
          });
        }
        return { selection, history, response: asMessage(assistant), generationId };
      });
    },

    async finishTurn(
      userId: string,
      conversationId: string,
      generationId: string,
      message: UIMessage,
      status: ResponseStatus
    ) {
      const parts = partsForStorage(message.parts);
      return prisma.$transaction(async (tx) => {
        const claimed = await tx.aiConversation.updateMany({
          where: { id: conversationId, userId, scope, activeGenerationId: generationId },
          data: { activeGenerationId: null, generationStartedAt: null },
        });
        // A deleted conversation or superseded generation must never be recreated.
        if (!claimed.count) {
          return;
        }
        await tx.aiMessage.updateMany({
          where: { conversationId, id: message.id, role: 'assistant', conversation: { userId } },
          data: { parts, status },
        });
      });
    },
  };
}

export const conversationService = createConversationService();
