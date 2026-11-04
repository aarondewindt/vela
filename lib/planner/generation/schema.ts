import { z } from 'zod';
import { modelSelectionSchema } from '@/lib/model-settings/schema';

export const generateDaySchema = z
  .object({
    requestId: z.uuid(),
    date: z.iso.date(),
    mode: z.enum(['ai', 'deterministic']).default('ai'),
    guidance: z.string().trim().max(2000).default(''),
    selection: modelSelectionSchema.nullable().optional(),
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
