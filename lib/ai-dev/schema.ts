import { z } from 'zod';

export const maxMessageLength = 16_000;
export const selectionSchema = z.object({
  provider: z.literal('ollama'),
  modelId: z.string().min(1).max(200),
});
export const conversationIdSchema = z.object({ id: z.uuid() });
const textPartSchema = z.object({
  type: z.literal('text'),
  text: z.string().max(maxMessageLength),
  state: z.enum(['streaming', 'done']).optional(),
});
export const storedPartsSchema = z.array(
  z.discriminatedUnion('type', [textPartSchema, z.object({ type: z.literal('step-start') })])
);
export const chatInputSchema = z.object({
  conversationId: z.uuid(),
  message: z.object({
    id: z.string().min(1).max(128),
    role: z.literal('user'),
    parts: z
      .array(textPartSchema)
      .min(1)
      .max(32)
      .refine((parts) => parts.some((part) => part.text.trim().length > 0), 'Enter a message.')
      .refine(
        (parts) => parts.reduce((sum, part) => sum + part.text.length, 0) <= maxMessageLength,
        'The message is too long.'
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
  selection: selectionSchema,
  text: embeddingTextSchema,
});
export const comparisonInputSchema = z.object({
  selection: selectionSchema,
  textA: embeddingTextSchema,
  textB: embeddingTextSchema,
});
export type EmbeddingInput = z.infer<typeof embeddingInputSchema>;
export type ComparisonInput = z.infer<typeof comparisonInputSchema>;
