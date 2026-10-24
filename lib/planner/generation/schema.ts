import { z } from 'zod';

export const generateDaySchema = z
  .object({
    requestId: z.uuid(),
    date: z.iso.date(),
    mode: z.enum(['ai', 'deterministic']).default('ai'),
    guidance: z.string().trim().max(2000).default(''),
    reviseProposalId: z.uuid().optional(),
    taskLimits: z
      .array(
        z
          .object({
            taskQuery: z.string().trim().min(1).max(240),
            maxMinutes: z.number().int().min(0).max(1440),
          })
          .strict()
      )
      .max(40)
      .default([]),
    freeTimes: z
      .array(
        z
          .object({
            startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
            endTime: z.string().regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/),
          })
          .strict()
      )
      .max(16)
      .default([]),
  })
  .strict();

export const selectionSchema = z
  .object({
    summary: z.string().trim().min(1).max(1500),
    // A planning preference; never changes task facts or session/availability constraints.
    workBudgetMinutes: z.number().int().min(0).max(1440).nullable(),
    selected: z
      .array(
        z
          .object({
            key: z.string(),
            reason: z.string().trim().min(1).max(700),
            plannedMinutes: z.number().int().positive().max(1440).nullable().optional(),
          })
          .strict()
      )
      .max(80),
    omitted: z
      .array(z.object({ key: z.string(), reason: z.string().trim().min(1).max(700) }).strict())
      .max(80),
  })
  .strict();
export type Selection = z.infer<typeof selectionSchema>;
