import { z } from 'zod';
import { diaryDateSchema } from './dates';
import { mealCategories } from './types';

export const historyInputSchema = z
  .object({ endDate: diaryDateSchema, days: z.union([z.literal(7), z.literal(30)]) })
  .refine(
    (input) =>
      new Date(`${input.endDate}T00:00:00Z`).getTime() >=
      new Date('0001-01-01T00:00:00Z').getTime() + (input.days - 1) * 86_400_000,
    'Choose an end date with enough previous days.'
  );
export type HistoryInput = z.infer<typeof historyInputSchema>;
export const copyMealSchema = z
  .object({
    requestId: z.uuid(),
    sourceDate: diaryDateSchema,
    targetDate: diaryDateSchema,
    sourceMeal: z.enum(mealCategories),
    targetMeal: z.enum(mealCategories),
    entries: z
      .array(z.object({ id: z.uuid(), version: z.number().int().positive() }))
      .min(1)
      .max(100),
  })
  .superRefine((input, ctx) => {
    if (input.sourceDate === input.targetDate && input.sourceMeal === input.targetMeal) {
      ctx.addIssue({ code: 'custom', message: 'Choose a different destination meal or date.' });
    }
    if (new Set(input.entries.map((entry) => entry.id)).size !== input.entries.length) {
      ctx.addIssue({ code: 'custom', message: 'Select each food entry once.' });
    }
  });
export type CopyMealInput = z.infer<typeof copyMealSchema>;
