import { z } from 'zod';
import { planningCategories, taskStatuses } from './tasks';
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
