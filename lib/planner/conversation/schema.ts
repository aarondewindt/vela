import { z } from 'zod';
import { taskPatchSchema, themePatchSchema } from '../record-schema';

const query = z.string().trim().min(1).max(240);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const instructionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('clarify'), question: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ type: z.literal('find'), entity: z.enum(['task', 'theme']), query }).strict(),
  z
    .object({
      type: z.literal('record'),
      entity: z.enum(['task', 'theme']),
      action: z.enum(['create', 'update', 'delete']),
      query: query.nullable(),
      task: taskPatchSchema
        .omit({ themeId: true, recurrence: true })
        .extend({ themeQuery: query.nullable().optional() })
        .strict()
        .nullable(),
      theme: themePatchSchema.nullable(),
    })
    .strict(),
  z
    .object({ type: z.literal('generate'), date: z.iso.date(), guidance: z.string().max(2000) })
    .strict(),
  z
    .object({ type: z.literal('explain'), date: z.iso.date(), question: z.string().max(2000) })
    .strict(),
  z
    .object({
      type: z.literal('replan'),
      date: z.iso.date(),
      action: z.enum(['replan', 'extend', 'finish', 'postpone', 'skip', 'cancel', 'replace']),
      blockQuery: query.nullable(),
      candidateQuery: query.nullable(),
      startTime: time.nullable(),
      endTime: time.nullable(),
      additionalMinutes: z.number().int().min(1).max(1440).nullable(),
      completeTask: z.boolean(),
      explanation: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal('edit'),
      date: z.iso.date(),
      action: z.enum(['add', 'move', 'resize', 'remove', 'replace']),
      blockQuery: query.nullable(),
      candidateQuery: query.nullable(),
      startTime: time.nullable(),
      endTime: time.nullable(),
      explanation: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal('reserve'),
      date: z.iso.date(),
      startTime: time,
      endTime: time,
      explanation: z.string().trim().min(1).max(2000),
    })
    .strict(),
]);
export type Instruction = z.infer<typeof instructionSchema>;
export const turnSchema = z
  .object({
    conversationId: z.uuid(),
    requestId: z.uuid(),
    revision: z.number().int().min(0),
    date: z.iso.date(),
    text: z.string().trim().min(1).max(2000),
  })
  .strict();
export const acceptSchema = z
  .object({
    conversationId: z.uuid(),
    turnId: z.uuid(),
    confirmDeletion: z.boolean().default(false),
  })
  .strict();
export const recordPreviewSchema = z.object({
  entity: z.enum(['task', 'theme']),
  action: z.enum(['create', 'update', 'delete']),
  id: z.uuid().nullable(),
  baseHash: z.string(),
  before: z.record(z.string(), z.unknown()).nullable(),
  patch: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string()),
  references: z.record(z.string(), z.string()).optional(),
});
export type RecordPreview = z.infer<typeof recordPreviewSchema>;
export const resultSchema = z.object({
  reply: z.string(),
  date: z.iso.date(),
  timezone: z.string(),
  model: z.object({ provider: z.literal('ollama'), modelId: z.string() }),
  instruction: instructionSchema,
  record: recordPreviewSchema.optional(),
  proposalId: z.uuid().optional(),
  matches: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  // Typed reviews and generation reports remain rendered by their owning components.
  details: z.string().optional(),
});
export type ConversationResult = z.infer<typeof resultSchema>;
