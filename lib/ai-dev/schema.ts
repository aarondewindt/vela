import { z } from 'zod';
import { productSuggestionSchema } from '@/lib/nutrition/product-extraction/schema';
import { plannerDebugSchema } from '@/lib/planner/chat/debug-schema';
import { planningResultSchema } from '@/lib/planner/chat/result';
import { modelSelectionSchema } from '@/lib/model-settings/schema';

export const maxMessageLength = 16_000;
export const selectionSchema = modelSelectionSchema;
export const productModelStages = ['transcription', 'interpretation'] as const;
export const productModelStageSchema = z.enum(productModelStages);
export type ProductModelStage = z.infer<typeof productModelStageSchema>;
export const stageOverridesSchema = z
  .object({
    transcription: selectionSchema.nullable().optional(),
    interpretation: selectionSchema.nullable().optional(),
  })
  .strict();
export type StageOverrides = z.infer<typeof stageOverridesSchema>;
export const stageSelectionsSchema = z
  .object({
    transcription: selectionSchema,
    interpretation: selectionSchema,
  })
  .strict();
export type StageSelections = z.infer<typeof stageSelectionsSchema>;
export const createConversationSchema = z.object({
  selection: selectionSchema.nullable().default(null),
});
export const changeConversationModelSchema = z.object({
  id: z.uuid(),
  selection: selectionSchema.nullable(),
});
export const createProductConversationSchema = createConversationSchema.extend({
  stageOverrides: stageOverridesSchema.optional(),
});
export const changeConversationStageModelSchema = z
  .object({
    id: z.uuid(),
    stage: productModelStageSchema,
    selection: selectionSchema.nullable(),
  })
  .strict();
export const conversationIdSchema = z.object({ id: z.uuid() });
export const textPartSchema = z.object({
  type: z.literal('text'),
  text: z.string().max(maxMessageLength),
  state: z.enum(['streaming', 'done']).optional(),
});
export const attachmentPartSchema = z
  .object({
    type: z.literal('data-attachment'),
    data: z.object({ attachmentId: z.uuid() }).strict(),
  })
  .strict();
export function attachmentId(part: unknown) {
  return attachmentPartSchema.parse(part).data.attachmentId;
}
export const userPartSchema = z.discriminatedUnion('type', [textPartSchema, attachmentPartSchema]);
export const maxMessageImages = 8;
export const maxHistoryImages = 16;
export const storedPartsSchema = z.array(
  z.discriminatedUnion('type', [
    textPartSchema,
    attachmentPartSchema,
    z.object({ type: z.literal('step-start') }),
    z.object({ type: z.literal('data-productSuggestion'), data: productSuggestionSchema }),
    z.object({ type: z.literal('data-planning'), data: planningResultSchema }),
    z.object({ type: z.literal('data-plannerDebug'), data: plannerDebugSchema }),
  ])
);
export const chatInputSchema = z.object({
  conversationId: z.uuid(),
  rereadImages: z.boolean().optional(),
  message: z.object({
    id: z.string().min(1).max(128),
    role: z.literal('user'),
    parts: z
      .array(userPartSchema)
      .min(1)
      .max(32)
      .refine(
        (parts) =>
          parts.some((part) => part.type === 'data-attachment' || part.text.trim().length > 0),
        'Enter a message.'
      )
      .refine(
        (parts) =>
          parts.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 0), 0) <=
          maxMessageLength,
        'The message is too long.'
      )
      .refine(
        (parts) =>
          parts.filter((part) => part.type === 'data-attachment').length <= maxMessageImages,
        'Too many images in one message.'
      ),
  }),
});
export type ChatInput = z.infer<typeof chatInputSchema>;

export const maxEmbeddingTextLength = 16_000;
const embeddingTextSchema = z
  .string()
  .max(maxEmbeddingTextLength)
  .refine((text) => text.trim().length > 0, 'Enter text to embed.');
export const embeddingInputSchema = z.object({
  selection: selectionSchema.nullable().default(null),
  text: embeddingTextSchema,
});
export const comparisonInputSchema = z.object({
  selection: selectionSchema.nullable().default(null),
  textA: embeddingTextSchema,
  textB: embeddingTextSchema,
});
export type EmbeddingInput = z.infer<typeof embeddingInputSchema>;
export type ComparisonInput = z.infer<typeof comparisonInputSchema>;
