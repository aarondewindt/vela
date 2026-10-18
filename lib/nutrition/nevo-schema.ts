import { z } from 'zod';

export const maxNevoFileBytes = 5 * 1024 * 1024;
export const maxNevoRows = 10_000;
export const nevoUploadSchema = z.object({
  csv: z.string().min(1).max(maxNevoFileBytes),
  overwriteEdited: z.boolean().default(false),
});
export const nevoApplySchema = nevoUploadSchema.extend({
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
});
