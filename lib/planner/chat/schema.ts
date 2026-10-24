import { chatInputSchema } from '@/lib/ai-dev/schema';
import { z } from 'zod';
export const plannerChatInputSchema = chatInputSchema
  .extend({
    date: z.iso.date(),
    proposalId: z.uuid().nullable().optional(),
    focusedBlockId: z.string().max(128).nullable().optional(),
    focusedTaskId: z.uuid().nullable().optional(),
  })
  .refine(
    (value) => value.message.parts.reduce((sum, part) => sum + part.text.length, 0) <= 2000,
    'Planner messages support up to 2,000 characters.'
  );
