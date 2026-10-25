import { z } from 'zod';
import { modelSelectionSchema } from '@/lib/model-settings/schema';
import { documentSchema } from '../proposals/schema';

export const reviewDaySchema = z
  .object({
    date: z.iso.date(),
    proposalId: z.uuid().optional(),
    guidance: z.string().trim().max(2000).default(''),
    selection: modelSelectionSchema.nullable().optional(),
    mode: z.enum(['deterministic', 'ai']).default('deterministic'),
  })
  .strict();

const concernSchema = z.object({
  code: z.string(),
  blockIds: z.array(z.string()),
  taskIds: z.array(z.string()),
  explanation: z.string(),
});
const displacedSchema = z.object({
  title: z.string(),
  minutes: z.number(),
  due: z.string().nullable(),
  deadlineRisk: z.boolean(),
});
export const reviewResultSchema = z.object({
  date: z.iso.date(),
  proposalId: z.uuid().nullable(),
  baseHash: z.string(),
  timezone: z.string(),
  reviewedAt: z.string(),
  guidance: z.string(),
  mode: z.enum(['ai', 'deterministic']),
  model: z.object({ provider: z.literal('ollama'), modelId: z.string() }).nullable(),
  aiError: z.string().nullable(),
  conflicts: z.array(concernSchema),
  concerns: z.array(concernSchema),
  warnings: z.array(z.string()),
  blocks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
      status: z.string(),
    })
  ),
  corrections: z.array(
    z.object({
      blockId: z.string(),
      title: z.string(),
      explanation: z.string(),
      displaced: displacedSchema,
      replacement: displacedSchema.extend({ remainingMinutes: z.number() }).nullable(),
      document: documentSchema,
    })
  ),
});
