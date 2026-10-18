import { z } from 'zod';
import { diaryDateSchema } from './dates';
import { positiveDecimalSchema, quantityInputSchema, productInputSchema } from './schema';
import { mealCategories, sourceTypes } from './types';

export const diaryDaySchema = z.object({ date: diaryDateSchema });
export const createLogEntrySchema = z.object({
  requestId: z.uuid(),
  productId: z.uuid(),
  productVersion: z.number().int().positive(),
  logDate: diaryDateSchema,
  mealCategory: z.enum(mealCategories),
  input: quantityInputSchema,
});
export const updateLogEntrySchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  logDate: diaryDateSchema,
  mealCategory: z.enum(mealCategories),
  input: quantityInputSchema,
});
export const deleteLogEntrySchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
});
export const previewLogEntrySchema = z.object({ id: z.uuid(), input: quantityInputSchema });
export const goalsInputSchema = z.object({
  version: z.number().int().nonnegative(),
  calories: positiveDecimalSchema.nullable(),
  protein: positiveDecimalSchema.nullable(),
  carbohydrates: positiveDecimalSchema.nullable(),
  fat: positiveDecimalSchema.nullable(),
});

// Reuse catalog validation so a saved snapshot has the same unit and decimal contract.
export const referenceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  calculationVersion: z.literal('direct-v1'),
  productId: z.uuid(),
  productVersion: z.number().int().positive(),
  definition: productInputSchema,
  source: z.object({
    type: z.enum(sourceTypes),
    name: z.string().nullable(),
    recordId: z.string().nullable(),
    version: z.string().nullable(),
    importedAt: z.iso.datetime().nullable(),
  }),
});
export type ReferenceSnapshot = z.infer<typeof referenceSnapshotSchema>;
export type CreateLogEntryInput = z.infer<typeof createLogEntrySchema>;
export type UpdateLogEntryInput = z.infer<typeof updateLogEntrySchema>;
export type GoalsInput = z.infer<typeof goalsInputSchema>;
