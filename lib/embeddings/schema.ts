import { z } from 'zod';

export const modelSelectionSchema = z.object({
  provider: z.literal('ollama'),
  modelId: z.string().min(1).max(200),
});
export const rebuildSchema = z.object({
  selection: modelSelectionSchema,
  queryInstruction: z.string().trim().max(1000).default('Find tasks relevant to the search query.'),
});
export const configurationSchema = modelSelectionSchema.extend({
  modelDigest: z.string().min(1),
  dimensions: z.number().int().min(1).max(16_000),
  preparationVersion: z.string().min(1),
  documentPrefix: z.string(),
  queryPrefix: z.string(),
});
export const searchSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  limit: z.number().int().min(1).max(50).default(10),
});
