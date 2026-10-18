import { z } from 'zod';
import { modelSelectionSchema } from '@/lib/embeddings/schema';

export const hybridProductSearchSchema = z.object({
  query: z.string().trim().max(240).default(''),
  limit: z.number().int().min(1).max(50).default(30),
  semantic: z.boolean().default(true),
  ranking: z.enum(['text-first', 'related-first']).optional(),
});
export type HybridProductSearchInput = z.infer<typeof hybridProductSearchSchema>;
export const productRebuildSchema = z.object({
  selection: modelSelectionSchema,
  queryInstruction: z
    .string()
    .trim()
    .max(1000)
    .default('Find foods and food products relevant to the search query.'),
});
