import { z } from 'zod';

export const reviewDaySchema = z
  .object({
    date: z.iso.date(),
    proposalId: z.uuid().optional(),
    guidance: z.string().trim().max(2000).default(''),
    mode: z.enum(['deterministic', 'ai']).default('deterministic'),
  })
  .strict();
