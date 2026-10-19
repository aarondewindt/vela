import { z } from 'zod';

export const generateDaySchema = z
  .object({
    requestId: z.uuid(),
    date: z.iso.date(),
    mode: z.enum(['ai', 'deterministic']),
    guidance: z.string().trim().max(2000).default(''),
  })
  .strict();

export const selectionSchema = z
  .object({
    summary: z.string().trim().min(1).max(1500),
    // A planning preference; never changes task facts or session/availability constraints.
    workBudgetMinutes: z.number().int().min(0).max(1440).nullable(),
    selected: z
      .array(z.object({ key: z.string(), reason: z.string().trim().min(1).max(700) }).strict())
      .max(80),
    omitted: z
      .array(z.object({ key: z.string(), reason: z.string().trim().min(1).max(700) }).strict())
      .max(80),
  })
  .strict();
export type Selection = z.infer<typeof selectionSchema>;
