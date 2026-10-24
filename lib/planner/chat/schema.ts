import { chatInputSchema } from '@/lib/ai-dev/schema';
import { z } from 'zod';
export const plannerChatInputSchema = chatInputSchema.extend({ date: z.iso.date() });
