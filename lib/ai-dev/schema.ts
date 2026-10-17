import { z } from 'zod';

export const maxMessageLength = 16_000;

const textPartSchema = z.object({
  type: z.literal('text'),
  text: z.string().max(maxMessageLength),
  state: z.enum(['streaming', 'done']).optional(),
});

const messageSchema = z.object({
  id: z.string().min(1).max(128),
  role: z.enum(['user', 'assistant']),
  parts: z
    .array(
      z.discriminatedUnion('type', [textPartSchema, z.object({ type: z.literal('step-start') })])
    )
    .min(1)
    .max(32),
});

export const chatInputSchema = z.object({
  selection: z.object({
    provider: z.literal('ollama'),
    modelId: z.string().min(1).max(200),
  }),
  messages: z
    .array(messageSchema)
    .min(1)
    .max(100, 'Start a new conversation to continue chatting.')
    .refine((messages) => new Set(messages.map(({ id }) => id)).size === messages.length, {
      message: 'Message IDs must be unique.',
    })
    .refine((messages) => messages.at(-1)?.role === 'user', {
      message: 'A chat request must end with a user message.',
    })
    .refine(
      (messages) =>
        messages.every(
          (message) =>
            message.role !== 'user' ||
            message.parts.some((part) => part.type === 'text' && part.text.trim().length > 0)
        ),
      { message: 'User messages must contain text.' }
    )
    .refine(
      (messages) =>
        messages.reduce(
          (total, message) =>
            total +
            message.parts.reduce(
              (sum, part) => sum + (part.type === 'text' ? part.text.length : 0),
              0
            ),
          0
        ) <= 64_000,
      { message: 'This conversation is too long. Start a new conversation to continue.' }
    ),
});

export type ChatInput = z.infer<typeof chatInputSchema>;
