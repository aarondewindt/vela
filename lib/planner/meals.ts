import { z } from 'zod';

export const mealKinds = ['BREAKFAST', 'LUNCH', 'DINNER'] as const;
export const mealKindSchema = z.enum(mealKinds);
export type MealKind = z.infer<typeof mealKindSchema>;
export const mealTitles: Record<MealKind, string> = {
  BREAKFAST: 'Breakfast',
  LUNCH: 'Lunch',
  DINNER: 'Dinner',
};
const preference = z
  .object({
    enabled: z.boolean(),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    durationMinutes: z.number().int().min(5).max(240),
  })
  .strict()
  .refine((p) => p.endMinute - p.startMinute >= p.durationMinutes, {
    message: 'The meal window must fit its full preparation, eating and cleanup duration.',
  });
export const mealPreferencesSchema = z
  .object({
    BREAKFAST: preference,
    LUNCH: preference,
    DINNER: preference,
  })
  .strict();
export type MealPreferences = z.infer<typeof mealPreferencesSchema>;
// Opt in: existing plans and accounts do not acquire new requirements on upgrade.
export const DEFAULT_MEAL_PREFERENCES: MealPreferences = {
  BREAKFAST: { enabled: false, startMinute: 420, endMinute: 540, durationMinutes: 30 },
  LUNCH: { enabled: false, startMinute: 720, endMinute: 840, durationMinutes: 45 },
  DINNER: { enabled: false, startMinute: 1020, endMinute: 1200, durationMinutes: 60 },
};
export const readMealPreferences = (value: unknown): MealPreferences =>
  mealPreferencesSchema.parse(value ?? DEFAULT_MEAL_PREFERENCES);
export const saveMealPreferencesSchema = z
  .object({
    version: z.number().int().nonnegative(),
    preferences: mealPreferencesSchema,
  })
  .strict();
