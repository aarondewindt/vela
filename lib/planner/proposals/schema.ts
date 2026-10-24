import { mealKindSchema } from '../meals';
import { z } from 'zod';

const instant = z.iso
  .datetime({ offset: true })
  .refine((value) => new Date(value).getTime() % 60_000 === 0, 'Use whole minutes.');
const interval = { startsAt: instant, endsAt: instant };
const addition = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('TASK'),
      taskId: z.uuid(),
      occurrenceId: z.uuid().nullable(),
      ...interval,
    })
    .strict(),
  z.object({ kind: z.literal('REST'), ...interval }).strict(),
  z.object({ kind: z.literal('MEAL'), mealKind: mealKindSchema, ...interval }).strict(),
]);
export const operationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('skip'),
      blockId: z.uuid(),
      explicit: z.literal(true).optional(),
      explanation: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal('finish'),
      blockId: z.uuid(),
      endsAt: instant,
      completeTask: z.boolean(),
      explanation: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal('extend'),
      blockId: z.uuid(),
      endsAt: instant,
      estimatedMinutes: z.number().int().positive().max(525600).optional(),
      explanation: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal('add'),
      block: addition,
      explanation: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal('move'),
      explicit: z.literal(true).optional(),
      blockId: z.uuid(),
      ...interval,
      explanation: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal('resize'),
      explicit: z.literal(true).optional(),
      blockId: z.uuid(),
      ...interval,
      explanation: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal('remove'),
      explicit: z.literal(true).optional(),
      blockId: z.uuid(),
      explanation: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal('replace'),
      explicit: z.literal(true).optional(),
      blockId: z.uuid(),
      block: addition,
      explanation: z.string().trim().min(1).max(2000),
    })
    .strict(),
]);
export const reservationSchema = z
  .object({
    category: z.literal('LEISURE'),
    ...interval,
    explanation: z.string().trim().min(1).max(2000),
  })
  .strict();
export const generationReportSchema = z.object({
  requestHash: z.string(),
  mode: z.enum(['ai', 'deterministic']),
  model: z.object({ provider: z.literal('ollama'), modelId: z.string() }).nullable(),
  guidance: z.string(),
  summary: z.string(),
  selectionSummary: z.string().optional(),
  reviewBy: z.iso.datetime().optional(),
  planningGoal: z.enum(['fill', 'guided']).optional(),
  workBudgetMinutes: z.number().int().min(0).nullable().optional(),
  availableWindows: z.array(z.object({ startsAt: z.string(), endsAt: z.string() })).optional(),
  additionalCandidateCount: z.number().int().min(0).optional(),
  diagnostics: z
    .object({
      elapsedMs: z.number().nonnegative(),
      candidateCount: z.number().int().nonnegative(),
      operationCount: z.number().int().nonnegative(),
    })
    .optional(),
  meals: z
    .array(
      z.object({
        mealKind: mealKindSchema,
        status: z.enum(['scheduled', 'preserved', 'unmet', 'skipped']),
        reason: z.string(),
      })
    )
    .optional(),
  warnings: z.array(z.string()),
  outcomes: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      remainingMinutes: z.number(),
      scheduledMinutes: z.number(),
      plannedMinutes: z.number().int().positive().max(1440).optional(),
      reason: z.string(),
      selectionReason: z.string().optional(),
      deadlineRisk: z.boolean(),
    })
  ),
});
export type GenerationReport = z.infer<typeof generationReportSchema>;
export const freeIntervalSchema = z
  .object({ ...interval, explanation: z.string().trim().min(1).max(2000) })
  .strict();
const selectionExplanationSchema = z.object({
  summary: z.string().max(1500),
  reasons: z
    .array(z.object({ title: z.string().max(240), reason: z.string().max(1000) }))
    .max(1000),
});
export const taskLimitSchema = z
  .object({
    taskId: z.uuid(),
    title: z.string().max(240),
    startsAt: instant,
    maxMinutes: z.number().int().min(0).max(1440),
  })
  .strict();
export const documentSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskLimits: z.array(taskLimitSchema).max(40).optional(),
    selectionExplanation: selectionExplanationSchema.optional(),
    freeIntervals: z.array(freeIntervalSchema).max(16).optional(),
    operations: z.array(operationSchema).max(100),
    reservations: z.array(reservationSchema).max(16).optional(),
    generation: generationReportSchema.optional(),
    replan: z
      .object({
        requestHash: z.string(),
        warnings: z.array(z.string()),
        reviewBy: instant.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.operations.length > 0 ||
      Boolean(d.reservations?.length) ||
      Boolean(d.freeIntervals?.length) ||
      Boolean(d.taskLimits?.length),
    'A proposal needs a change.'
  );
export const createProposalSchema = z
  .object({
    requestId: z.uuid(),
    date: z.iso.date(),
    baseHash: z.string().regex(/^[a-f0-9]{64}$/),
    document: documentSchema,
  })
  .strict();
export const proposalIdSchema = z.object({ id: z.uuid() }).strict();
export const dateSchema = z.object({ date: z.iso.date() }).strict();
export const editSchema = z
  .object({
    requestId: z.uuid(),
    date: z.iso.date(),
    baseHash: z.string().regex(/^[a-f0-9]{64}$/),
    type: z.enum(['add', 'move', 'resize', 'remove', 'replace']),
    blockId: z.uuid().optional(),
    candidateId: z.string().max(200).optional(),
    kind: z.enum(['TASK', 'REST']).default('TASK'),
    startTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    endTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    explanation: z.string().trim().min(1).max(2000),
  })
  .strict();
export type ProposalDocument = z.infer<typeof documentSchema>;
export type ProposalOperation = z.infer<typeof operationSchema>;
export type Addition = z.infer<typeof addition>;

const previewBlock = z.object({
  taskId: z.string().nullable().optional(),
  id: z.string(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  durationMinutes: z.number(),
  status: z.string().optional(),
});
export const previewSchema = z.object({
  taskLimits: z.array(taskLimitSchema).max(40).optional(),
  selectionExplanation: selectionExplanationSchema.optional(),
  freeIntervals: z.array(freeIntervalSchema).max(16).optional(),
  replan: z.object({ warnings: z.array(z.string()), reviewBy: instant.optional() }).optional(),
  taskChanges: z
    .array(
      z.object({
        taskId: z.string(),
        title: z.string(),
        estimatedMinutes: z.number().optional(),
        complete: z.boolean().optional(),
      })
    )
    .optional(),
  reservations: z.array(reservationSchema).optional(),
  generation: generationReportSchema.optional(),
  changes: z.array(
    z.object({
      type: z.string(),
      explanation: z.string(),
      before: previewBlock.nullable(),
      after: previewBlock.nullable(),
    })
  ),
  warnings: z.array(z.string()),
  remaining: z.array(
    z.object({ key: z.string(), taskId: z.string(), title: z.string(), minutes: z.number() })
  ),
});
export const receiptSchema = z.object({
  planId: z.string(),
  addedBlockIds: z.array(z.string()),
  changedBlockIds: z.array(z.string()),
  appliedAt: z.string(),
});

export const replanSchema = z
  .object({
    requestId: z.uuid(),
    date: z.iso.date(),
    baseHash: z.string().regex(/^[a-f0-9]{64}$/),
    action: z.enum(['replan', 'extend', 'finish', 'postpone', 'skip', 'cancel', 'replace']),
    blockId: z.uuid().optional(),
    endTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    startTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    candidateId: z.string().max(200).optional(),
    completeTask: z.boolean().default(false),
    estimatedMinutes: z.number().int().positive().max(525600).optional(),
    pullForward: z.boolean().default(false),
    explanation: z.string().trim().min(1).max(2000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const require = (field: 'blockId' | 'endTime' | 'startTime' | 'candidateId') => {
      if (!value[field]) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'Required for this progress action.',
        });
      }
    };
    if (value.action !== 'replan') {
      require('blockId');
    }
    if (value.action === 'finish' || value.action === 'extend') {
      require('endTime');
    }
    if (value.action === 'postpone') {
      require('startTime');
    }
    if (value.action === 'replace') {
      require('candidateId');
    }
    if (value.completeTask && value.action !== 'finish') {
      ctx.addIssue({
        code: 'custom',
        path: ['completeTask'],
        message: 'Only an explicit finish can complete work.',
      });
    }
    if (value.estimatedMinutes !== undefined && value.action !== 'extend') {
      ctx.addIssue({
        code: 'custom',
        path: ['estimatedMinutes'],
        message: 'Estimate changes require an explicit extension.',
      });
    }
  });
export type ReplanInput = z.infer<typeof replanSchema>;
