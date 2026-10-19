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
]);
export const operationSchema = z.discriminatedUnion('type', [
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
      blockId: z.uuid(),
      ...interval,
      explanation: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal('resize'),
      blockId: z.uuid(),
      ...interval,
      explanation: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal('remove'),
      blockId: z.uuid(),
      explanation: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal('replace'),
      blockId: z.uuid(),
      block: addition,
      explanation: z.string().trim().min(1).max(2000),
    })
    .strict(),
]);
export const documentSchema = z
  .object({ schemaVersion: z.literal(1), operations: z.array(operationSchema).min(1).max(100) })
  .strict();
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
  id: z.string(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  durationMinutes: z.number(),
});
export const previewSchema = z.object({
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
