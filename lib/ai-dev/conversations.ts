import 'server-only';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { UIMessage } from 'ai';
import { retainAttachments } from '@/lib/attachments/service';
import { prisma } from '@/lib/prisma';
import { resolveChatModel, validateModelSelection, type AiModelSelection } from '@/lib/ai';
import {
  attachmentId,
  selectionSchema,
  storedPartsSchema,
  maxHistoryImages,
  stageOverridesSchema,
  stageSelectionsSchema,
  type StageOverrides,
  type StageSelections,
  type ProductModelStage,
  type ChatInput,
} from './schema';
import {
  effectiveModel,
  requireModelSelection,
  readModelSettings,
} from '@/lib/model-settings/service';
import { resolveModelSetting, requiredModelCapabilities } from '@/lib/model-settings/schema';
import { AiError } from '@/lib/ai/errors';

export const generationLeaseMs = 600_000;

/** Absent stage JSON belongs to an older conversation; its model remains transcription. */
function productOverrides(conversation: {
  modelSelections?: unknown;
  inheritsModel?: boolean;
  provider: string;
  modelId: string;
}): Required<StageOverrides> {
  const saved = conversation.modelSelections
    ? stageOverridesSchema.parse(conversation.modelSelections)
    : {};
  return {
    transcription:
      saved.transcription !== undefined
        ? saved.transcription
        : conversation.inheritsModel
          ? null
          : selectionSchema.parse({
              provider: conversation.provider,
              modelId: conversation.modelId,
            }),
    interpretation: saved.interpretation ?? null,
  };
}

async function resolveProductStages(
  userId: string,
  overrides: StageOverrides,
  db: Parameters<typeof readModelSettings>[1]
) {
  const settings = await readModelSettings(userId, db);
  return {
    transcription: resolveModelSetting(
      settings,
      'nutrition.productImport',
      overrides.transcription
    ),
    interpretation: resolveModelSetting(
      settings,
      'nutrition.productInterpretation',
      overrides.interpretation
    ),
  };
}

function requireStageSelections(
  resolved: Awaited<ReturnType<typeof resolveProductStages>>
): StageSelections {
  if (!resolved.transcription.selection || !resolved.interpretation.selection) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Configure both extraction models in Settings → AI & models, or select models here.',
    });
  }
  return {
    transcription: resolved.transcription.selection,
    interpretation: resolved.interpretation.selection,
  };
}
export type ResponseStatus = 'COMPLETED' | 'INTERRUPTED' | 'FAILED';

async function validateStageSelection(stage: ProductModelStage, selection: AiModelSelection) {
  try {
    await validateModelSelection(selection, [
      ...requiredModelCapabilities(
        stage === 'transcription' ? 'nutrition.productImport' : 'nutrition.productInterpretation'
      ),
    ]);
  } catch (error) {
    if (error instanceof AiError) {
      throw new AiError(
        error.code,
        `${stage === 'transcription' ? 'Vision transcription' : 'Text interpretation'}: ${error.message}`
      );
    }
    throw error;
  }
}

const stageFailureSchema = z.object({
  lastFailure: z.object({
    stage: z.enum(['transcription', 'interpretation']),
    message: z.string().trim().min(1).max(500),
  }),
});

/** Expose stage diagnostics without returning checkpoint contents or provider error payloads. */
function lastStageFailure(message: { status: string; pipelineCheckpoint?: unknown } | undefined) {
  if (!message || !['FAILED', 'INTERRUPTED'].includes(message.status)) {
    return null;
  }
  const parsed = stageFailureSchema.safeParse(message.pipelineCheckpoint);
  if (!parsed.success) {
    return null;
  }
  const stage = parsed.data.lastFailure.stage;
  const label = stage === 'transcription' ? 'Vision transcription' : 'Text interpretation';
  return { stage, label, message: `${label} failed. Check the selected model and retry.` };
}

function partsForStorage(value: unknown) {
  return storedPartsSchema
    .parse(value)
    .map((part) =>
      part.type === 'text'
        ? { type: 'text' as const, text: part.text, state: 'done' as const }
        : part.type === 'data-planning' ||
            part.type === 'data-plannerDebug' ||
            part.type === 'data-productSuggestion' ||
            part.type === 'data-attachment'
          ? part
          : { type: 'step-start' as const }
    );
}

function asMessage(row: {
  id: string;
  role: 'user' | 'assistant';
  parts: unknown;
  provider?: string | null;
  modelId?: string | null;
  modelSelections?: unknown;
}): UIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: partsForStorage(row.parts),
    ...(row.modelId
      ? {
          metadata: {
            provider: row.provider,
            modelId: row.modelId,
            ...(row.modelSelections
              ? { modelSelections: stageSelectionsSchema.parse(row.modelSelections) }
              : {}),
          },
        }
      : {}),
  };
}

function notFound(): never {
  throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found.' });
}

export function createConversationService(
  scope: 'ai-dev' | 'planner' | 'nutrition-product' = 'ai-dev',
  database = prisma
) {
  const feature =
    scope === 'planner'
      ? 'planner.conversation'
      : scope === 'nutrition-product'
        ? 'nutrition.productImport'
        : 'aiDev.chat';
  async function changeStageModel(
    userId: string,
    id: string,
    stage: ProductModelStage,
    override: AiModelSelection | null
  ) {
    if (scope !== 'nutrition-product') {
      return notFound();
    }
    const existing = await database.aiConversation.findFirst({
      where: { id, userId, scope },
      select: { id: true },
    });
    if (!existing) {
      return notFound();
    }
    if (override) {
      await validateStageSelection(stage, override);
    }
    return database.$transaction(async (tx) => {
      // Lock before reading the JSON so independent simultaneous edits cannot lose a stage.
      const changed = await tx.aiConversation.updateMany({
        where: { id, userId, scope, activeGenerationId: null },
        data: { updatedAt: new Date() },
      });
      if (!changed.count) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Wait for the active response to finish, then reload before changing models.',
        });
      }
      const conversation = await tx.aiConversation.findFirst({ where: { id, userId, scope } });
      if (!conversation) {
        return notFound();
      }
      const overrides = { ...productOverrides(conversation), [stage]: override };
      await tx.aiConversation.updateMany({
        where: { id, userId, scope, activeGenerationId: null },
        data: {
          modelSelections: overrides,
          ...(stage === 'transcription'
            ? {
                inheritsModel: !override,
                ...(override ? { provider: override.provider, modelId: override.modelId } : {}),
              }
            : {}),
        },
      });
      return { updated: true };
    });
  }
  return {
    changeStageModel,
    list(userId: string) {
      return database.aiConversation.findMany({
        where: { userId, scope },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          title: true,
          productId: true,
          provider: true,
          modelId: true,
          inheritsModel: true,
          updatedAt: true,
        },
      });
    },

    async create(
      userId: string,
      override: AiModelSelection | null = null,
      stageOverrides?: StageOverrides
    ) {
      const overrides =
        scope === 'nutrition-product'
          ? { transcription: override, interpretation: null, ...stageOverrides }
          : undefined;
      const stages = overrides
        ? requireStageSelections(await resolveProductStages(userId, overrides, database))
        : undefined;
      const selection =
        stages?.transcription ?? (await requireModelSelection(userId, feature, override));
      if (stages) {
        await validateStageSelection('transcription', stages.transcription);
        await validateStageSelection('interpretation', stages.interpretation);
      } else {
        await resolveChatModel(selection);
      }
      return database.aiConversation.create({
        data: {
          userId,
          scope,
          provider: selection.provider,
          modelId: selection.modelId,
          inheritsModel: overrides ? !overrides.transcription : !override,
          ...(overrides ? { modelSelections: overrides } : {}),
        },
        select: { id: true },
      });
    },

    async changeModel(userId: string, id: string, override: AiModelSelection | null) {
      if (scope === 'nutrition-product') {
        return changeStageModel(userId, id, 'transcription', override);
      }
      const existing = await database.aiConversation.findFirst({
        where: { id, userId, scope },
        select: { id: true },
      });
      if (!existing) {
        return notFound();
      }
      if (override) {
        await resolveChatModel(override);
      }
      const changed = await database.aiConversation.updateMany({
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
      return database.$transaction(async (tx) => {
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
        const overrides =
          scope === 'nutrition-product' ? productOverrides(conversation) : undefined;
        const stages = overrides ? await resolveProductStages(userId, overrides, tx) : undefined;
        const lastResponse = conversation.messages
          .filter((message) => message.role === 'assistant')
          .at(-1);
        return {
          lastStageFailure: scope === 'nutrition-product' ? lastStageFailure(lastResponse) : null,
          ...(overrides && stages ? { stageOverrides: overrides, stageSelections: stages } : {}),
          id: conversation.id,
          title: conversation.title,
          productId: conversation.productId,
          override: overrides
            ? overrides.transcription
            : conversation.inheritsModel
              ? null
              : selectionSchema.parse({
                  provider: conversation.provider,
                  modelId: conversation.modelId,
                }),
          ...(stages
            ? stages.transcription
            : await effectiveModel(
                userId,
                feature,
                overrides
                  ? overrides.transcription
                  : conversation.inheritsModel
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
          lastResponseStatus: lastResponse?.status ?? null,
        };
      });
    },

    async delete(userId: string, id: string) {
      const result = await database.aiConversation.deleteMany({ where: { id, userId, scope } });
      if (!result.count) {
        return notFound();
      }
      return { deleted: true };
    },

    async listForProduct(userId: string, productId: string) {
      if (scope !== 'nutrition-product') {
        return notFound();
      }
      const product = await database.product.findFirst({
        where: { id: productId, userId },
        select: { id: true },
      });
      if (!product) {
        return notFound();
      }
      return database.aiConversation.findMany({
        where: { userId, scope, productId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, title: true, updatedAt: true },
      });
    },

    async linkProduct(userId: string, id: string, productId: string) {
      if (scope !== 'nutrition-product') {
        return notFound();
      }
      return database.$transaction(async (tx) => {
        const product = await tx.product.findFirst({
          where: { id: productId, userId },
          select: { id: true },
        });
        if (!product) {
          return notFound();
        }
        // Linking is idempotent, but an existing association cannot be silently moved.
        const linked = await tx.aiConversation.updateMany({
          where: { id, userId, scope, OR: [{ productId: null }, { productId }] },
          data: { productId },
        });
        if (!linked.count) {
          return notFound();
        }
        return { id, productId };
      });
    },

    async beginTurn(userId: string, input: ChatInput) {
      const generationId = randomUUID();
      const conversationId = input.conversationId;
      const parts = partsForStorage(input.message.parts);
      return database.$transaction(async (tx) => {
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
            stageSelections: previousReply.modelSelections
              ? stageSelectionsSchema.parse(previousReply.modelSelections)
              : undefined,
            checkpoint: previousReply.pipelineCheckpoint ?? null,
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
        const productStageSelections =
          scope === 'nutrition-product'
            ? requireStageSelections(
                await resolveProductStages(userId, productOverrides(conversation), tx)
              )
            : undefined;
        const checkpoint =
          previousReply?.pipelineCheckpoint ??
          conversation.messages
            .filter(
              (message) =>
                message.role === 'assistant' &&
                message.pipelineCheckpoint !== null &&
                message.pipelineCheckpoint !== undefined
            )
            .at(-1)?.pipelineCheckpoint ??
          null;
        const selection =
          productStageSelections?.transcription ??
          (await requireModelSelection(
            userId,
            feature,
            conversation.inheritsModel
              ? null
              : {
                  provider: 'ollama',
                  modelId: conversation.modelId,
                },
            tx
          ));
        const history = conversation.messages
          .filter((message) => message.role === 'user' || message.status !== 'FAILED')
          .filter((message) => !previousReply || message.id !== previousReply.id)
          .map(asMessage)
          .filter((message) =>
            message.parts.some(
              (part) =>
                part.type === 'data-attachment' || (part.type === 'text' && part.text.trim())
            )
          );
        if (!existing) {
          history.push({ ...input.message, parts });
        }
        const characters = history.reduce(
          (total, message) =>
            total +
            message.parts.reduce(
              (sum, part) =>
                sum +
                (part.type === 'text'
                  ? part.text.length
                  : part.type === 'data-productSuggestion'
                    ? JSON.stringify(
                        scope === 'nutrition-product'
                          ? (part.data as { product: unknown }).product
                          : part.data
                      ).length
                    : 0),
              0
            ),
          0
        );
        const imageIds = history.flatMap((message) =>
          message.parts.flatMap((part) =>
            part.type === 'data-attachment' ? [attachmentId(part)] : []
          )
        );
        // Nutrition retries may repeat the same pending photos with new stage selections.
        const imageCount = scope === 'nutrition-product' ? new Set(imageIds).size : imageIds.length;
        if (imageCount > maxHistoryImages || history.length > 100 || characters > 64_000) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This conversation is too long. Start a new conversation to continue.',
          });
        }
        // Retain all references atomically with persistence, including retry/history references.
        if (imageIds.length) {
          await retainAttachments(tx, userId, imageIds);
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
                ...(productStageSelections ? { modelSelections: productStageSelections } : {}),
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
                ...(productStageSelections ? { modelSelections: productStageSelections } : {}),
              },
            });
        if (conversation.messages.length === 0) {
          const title =
            parts
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join(' ')
              .trim()
              .slice(0, 80) || 'Image conversation';
          await tx.aiConversation.updateMany({
            where: { id: conversationId, userId, scope },
            data: { title },
          });
        }
        return {
          selection,
          stageSelections: productStageSelections,
          checkpoint,
          history,
          response: asMessage(assistant),
          generationId,
        };
      });
    },

    /** Persist validated intermediate work without completing the generation. */
    async saveCheckpoint(
      userId: string,
      conversationId: string,
      generationId: string,
      messageId: string,
      value: unknown
    ) {
      const checkpoint = z.record(z.string(), z.json()).parse(value);
      if (Buffer.byteLength(JSON.stringify(checkpoint), 'utf8') > 1_048_576) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The extraction evidence is too large.',
        });
      }
      return database.$transaction(async (tx) => {
        const claimed = await tx.aiConversation.updateMany({
          where: { id: conversationId, userId, scope, activeGenerationId: generationId },
          data: { updatedAt: new Date() },
        });
        if (!claimed.count) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This generation was superseded. Reload the conversation before retrying.',
          });
        }
        const saved = await tx.aiMessage.updateMany({
          where: {
            conversationId,
            id: messageId,
            role: 'assistant',
            status: 'GENERATING',
            conversation: { userId },
          },
          data: { pipelineCheckpoint: checkpoint },
        });
        if (!saved.count) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'This response is no longer generating. Reload the conversation before retrying.',
          });
        }
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
      if (parts.some((part) => part.type === 'data-attachment')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Assistant attachments are not supported.',
        });
      }
      return database.$transaction(async (tx) => {
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
