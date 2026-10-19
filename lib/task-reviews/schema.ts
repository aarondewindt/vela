import { z } from 'zod';
import { planningCategories } from '@/lib/planner/tasks';

export const focusScale = [
  '1 — Vague: desired outcome is unclear.',
  '2 — Emerging: outcome is identifiable, but scope or prerequisites are unclear.',
  '3 — Defined: outcome and scope are clear; an actionable next step is missing.',
  '4 — Actionable: scope and next step are clear; completion criteria need clarification.',
  '5 — Ready: outcome, scope, next step and completion criteria are explicit.',
] as const;

const explanation = z.string().trim().min(1).max(1200);
const assessment = <T extends z.ZodType>(value: T) => z.object({ value, explanation }).strict();
export const reviewDocumentSchema = z
  .object({
    summary: explanation,
    recordedFacts: z.array(explanation).max(12),
    inferredContext: z.array(explanation).max(12),
    missingInformation: z.array(explanation).max(12),
    priority: assessment(z.number().int().min(1).max(5).nullable()),
    size: assessment(z.number().int().min(1).max(5).nullable()),
    estimatedMinutes: assessment(z.number().int().min(1).max(10080).nullable()),
    focus: assessment(z.number().int().min(1).max(5)),
    dueDateRisk: assessment(z.enum(['unknown', 'low', 'medium', 'high', 'overdue'])),
    firstStep: assessment(z.string().trim().min(1).max(1000).nullable()),
    themeId: assessment(z.union([z.uuid(), z.literal('NONE')]).nullable()).optional(),
    category: assessment(z.enum([...planningCategories, 'INHERIT']).nullable()).optional(),
    brief: assessment(z.string().trim().max(4000).nullable()).optional(),
    tags: assessment(
      z
        .array(z.string().trim().min(1).max(40))
        .max(30)
        .refine((tags) => new Set(tags).size === tags.length, 'Tags must be unique.')
        .nullable()
    ).optional(),
    nextSteps: z.array(explanation).max(8),
    blockers: z.array(z.object({ blocker: explanation, unblock: explanation }).strict()).max(8),
  })
  .strict();
export type ReviewDocument = z.infer<typeof reviewDocumentSchema>;
// New generations require every assessment; optional fields keep saved v1 reviews readable.
export function generationReviewSchema(themeIds: string[]) {
  return reviewDocumentSchema
    .required({ themeId: true, category: true, brief: true, tags: true })
    .extend({ themeId: assessment(z.enum(['NONE', ...themeIds]).nullable()) });
}
export const taskReviewInput = z.object({ taskId: z.uuid() }).strict();
export const suggestionFields = [
  'priority',
  'size',
  'estimatedMinutes',
  'firstStep',
  'themeId',
  'category',
  'brief',
  'tags',
] as const;
export const acceptReviewInput = z
  .object({
    id: z.uuid(),
    fields: z.array(z.enum(suggestionFields)).min(1).max(suggestionFields.length),
  })
  .strict()
  .refine((input) => new Set(input.fields).size === input.fields.length, {
    message: 'Choose each suggestion once.',
  });
