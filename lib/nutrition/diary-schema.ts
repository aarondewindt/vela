import { goalOptionsSchema, validateGoalBounds } from '@/lib/goals/semantics';
import { z } from 'zod';
import { diaryDateSchema } from './dates';
import { positiveDecimalSchema, quantityInputSchema, productInputSchema } from './schema';
import { goalKeys, mealCategories, sourceTypes } from './types';

export const diaryDaySchema = z.object({ date: diaryDateSchema });
export const createLogEntrySchema = z.object({
  requestId: z.uuid(),
  productId: z.uuid(),
  productVersion: z.number().int().positive(),
  recipeRevision: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
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
export const nutritionGoalOptionsSchema = z
  .object({
    calories: goalOptionsSchema.optional(),
    protein: goalOptionsSchema.optional(),
    carbohydrates: goalOptionsSchema.optional(),
    fat: goalOptionsSchema.optional(),
    fiber: goalOptionsSchema.optional(),
  })
  .strict();
export const goalsInputSchema = z
  .object({
    semantics: nutritionGoalOptionsSchema.optional(),
    version: z.number().int().nonnegative(),
    calories: positiveDecimalSchema.nullable(),
    protein: positiveDecimalSchema.nullable(),
    carbohydrates: positiveDecimalSchema.nullable(),
    fat: positiveDecimalSchema.nullable(),
    fiber: positiveDecimalSchema.nullable().optional(),
  })
  .superRefine((input, ctx) => {
    for (const key of goalKeys) {
      const options = input.semantics?.[key];
      if (
        options &&
        (!validateGoalBounds(input[key] ?? null, options) ||
          ((options.kind === 'range' || options.kind === 'minimum') &&
            [
              options.preferredTarget,
              options.kind === 'range' ? options.upperBound : options.excellent,
            ].some(
              (value) => value !== undefined && !positiveDecimalSchema.safeParse(value).success
            )))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['semantics', key],
          message:
            'Range upper bound and thresholds must be positive and ordered: minimum ≤ preferred target ≤ maximum or excellent.',
        });
      }
    }
  });

// Reuse catalog validation so a saved snapshot has the same unit and decimal contract.
const directSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  calculationVersion: z.literal('direct-v1'),
  productId: z.uuid(),
  productVersion: z.number().int().positive(),
  definition: productInputSchema.refine((value) => value.calculationMode === 'DIRECT'),
  nutritionIsEstimated: z.boolean().optional(),
  source: z.object({
    type: z.enum(sourceTypes),
    name: z.string().nullable(),
    recordId: z.string().nullable(),
    version: z.string().nullable(),
    importedAt: z.iso.datetime().nullable(),
  }),
});
export const compositionNodeSchema = z.object({
  id: z.uuid(),
  name: z.string().max(240),
  version: z.number().int().positive(),
  calculationMode: z.enum(['DIRECT', 'CALCULATED']),
  definition: productInputSchema,
  source: directSnapshotSchema.shape.source.optional(),
});
export const recipeSnapshotSchema = directSnapshotSchema.extend({
  schemaVersion: z.literal(2),
  calculationVersion: z.literal('recipe-v1'),
  recipeRevision: z.string().regex(/^[0-9a-f]{64}$/),
  composition: z.array(compositionNodeSchema).min(1).max(250),
});
export const referenceSnapshotSchema = z.union([directSnapshotSchema, recipeSnapshotSchema]);
export type ReferenceSnapshot = z.infer<typeof referenceSnapshotSchema>;
export type CreateLogEntryInput = z.infer<typeof createLogEntrySchema>;
export type UpdateLogEntryInput = z.infer<typeof updateLogEntrySchema>;
export type GoalsInput = z.infer<typeof goalsInputSchema>;
