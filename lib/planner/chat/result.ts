import { z } from 'zod';
import { reviewResultSchema } from '../review/schema';
export const planningResultSchema = z.object({
  date: z.iso.date(),
  proposalId: z.uuid().optional(),
  reply: z.string().max(16000),
  review: reviewResultSchema.optional(),
});
