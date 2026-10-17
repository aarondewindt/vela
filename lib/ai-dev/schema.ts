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
