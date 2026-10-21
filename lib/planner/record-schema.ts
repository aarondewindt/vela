import { z } from 'zod';
import { planningCategories, taskStatuses } from './tasks';
import { supportedRecurrence } from './proposals/recurrence';

export const taskRecurrenceSchema = z
  .object({
    isRecurring: z.boolean(),
    recurrenceRule: z.string().trim().max(500).nullable(),
    recurrenceTz: z
      .string()
      .trim()
      .max(64)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Enter a valid IANA timezone.')
      .nullable(),
  })
  .refine((value) => !value.isRecurring || supportedRecurrence(value.recurrenceRule), {
    path: ['recurrenceRule'],
    message: 'Use FREQ=DAILY, WEEKLY, MONTHLY or YEARLY, optional INTERVAL and weekly BYDAY.',
  });
const id = z.uuid();
export const taskPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    brief: z.string().nullable().optional(),
    status: z.enum(taskStatuses).optional(),
    priority: z.number().int().min(1).max(5).optional(),
    size: z.number().int().min(0).max(5).optional(),
    dueDate: z.iso.date().nullable().optional(),
    estimatedMinutes: z.number().int().min(0).nullable().optional(),
    recurrence: taskRecurrenceSchema.optional(),
    leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
    themeId: id.nullable().optional(),
    category: z.enum(planningCategories).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  })
  .strict();
export const themePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    brief: z.string().nullable().optional(),
    color: z.string().max(32).nullable().optional(),
    category: z.enum(planningCategories).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
