import { z } from 'zod';
import { documentSchema } from '../proposals/schema';

const instant = z.iso.datetime({ offset: true });
export const draftBlockSchema = z.object({
  id: z.uuid(),
  title: z.string().max(240),
  mealKind: z.enum(['BREAKFAST', 'LUNCH', 'DINNER']).nullable().optional(),
  startsAt: instant,
  endsAt: instant,
  durationMinutes: z.number().int().positive(),
  category: z.enum(['WORK', 'LIFE', 'LEISURE', 'REST']).nullable(),
  taskId: z.uuid().nullable(),
  occurrenceId: z.uuid().nullable(),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'DONE', 'SKIPPED', 'CANCELED']),
  source: z.enum(['MANUAL', 'PLANNER', 'REPLAN', 'AUTOMATION']),
  isFixed: z.boolean(),
  calendarEventId: z.uuid().nullable(),
  manualOverride: z.boolean().default(false),
  isLocked: z.boolean().default(false),
});
export const draftStateSchema = z.object({
  blocks: z.array(draftBlockSchema).max(1000),
  slots: z
    .array(
      z.object({
        id: z.uuid(),
        category: z.enum(['WORK', 'LIFE', 'LEISURE', 'REST']),
        startsAt: instant,
        endsAt: instant,
        source: z.enum(['MANUAL', 'PLANNER']),
      })
    )
    .max(100),
  freeIntervals: documentSchema.shape.freeIntervals,
  taskLimits: documentSchema.shape.taskLimits,
});
export type DraftState = z.infer<typeof draftStateSchema>;
export const draftDateSchema = z.object({ date: z.iso.date() }).strict();
export const draftCommandSchema = draftDateSchema
  .extend({
    requestId: z.uuid(),
    draftId: z.uuid().nullable(),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export const applyDraftSchema = draftCommandSchema
  .extend({
    document: documentSchema,
    origin: z.enum(['manual', 'ai']),
    label: z.string().trim().min(1).max(240),
  })
  .strict();
export const cancelDraftSchema = draftCommandSchema
  .extend({ confirmed: z.boolean().default(false) })
  .strict();
