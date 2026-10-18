import { z } from 'zod';
import { modelSelectionSchema } from '@/lib/embeddings/schema';
import { diaryDateSchema } from './dates';
import { positiveDecimalSchema, quantityInputSchema } from './schema';
import { referenceSnapshotSchema } from './diary-schema';
import { mealCategories } from './types';

const querySchema = z.string().trim().min(1).max(240);
const unitSchema = z.string().trim().min(1).max(80).nullable();
const amount = { quantity: positiveDecimalSchema.nullable(), unit: unitSchema };
export const draftOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('addItem'), productQuery: querySchema, ...amount }).strict(),
  z.object({ type: z.literal('removeItem'), itemId: z.uuid() }).strict(),
  z.object({ type: z.literal('setQuantity'), itemId: z.uuid(), ...amount }).strict(),
  z
    .object({ type: z.literal('changeProduct'), itemId: z.uuid(), productQuery: querySchema })
    .strict(),
  z
    .object({ type: z.literal('changeMealCategory'), mealCategory: z.enum(mealCategories) })
    .strict(),
  z.object({ type: z.literal('changeDate'), date: diaryDateSchema.nullable() }).strict(),
]);
export const draftInterpretationSchema = z
  .object({
    operations: z.array(draftOperationSchema).max(30),
    questions: z.array(z.string().trim().min(1).max(300)).max(8),
    reply: z.string().trim().min(1).max(2000),
  })
  .strict();

export const draftItemSchema = z.object({
  id: z.uuid(),
  query: querySchema,
  ...amount,
  snapshot: referenceSnapshotSchema.nullable(),
  input: quantityInputSchema.nullable(),
  searchNotice: z.string().max(500).nullable().optional(),
  candidates: z
    .array(z.object({ id: z.uuid(), name: z.string(), brand: z.string().nullable() }))
    .max(5),
});
export const draftItemsSchema = z
  .array(draftItemSchema)
  .max(40)
  .superRefine((items, ctx) => {
    if (new Set(items.map((item) => item.id)).size !== items.length) {
      ctx.addIssue({ code: 'custom', message: 'Draft item IDs must be unique.' });
    }
  });
export type DraftItem = z.infer<typeof draftItemSchema>;
export type DraftInterpretation = z.infer<typeof draftInterpretationSchema>;

export const draftIdSchema = z.object({ id: z.uuid() });
export const draftRevisionSchema = draftIdSchema.extend({ revision: z.number().int().positive() });
export const createDraftSchema = z.object({
  id: z.uuid(),
  date: diaryDateSchema,
  mealCategory: z.enum(mealCategories),
  selection: modelSelectionSchema,
});
export const draftTurnSchema = draftRevisionSchema.extend({
  requestId: z.uuid(),
  text: z.string().trim().min(1).max(4000),
});
export const editDraftSchema = draftRevisionSchema.extend({
  change: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('header'),
      date: diaryDateSchema,
      mealCategory: z.enum(mealCategories),
    }),
    z.object({
      type: z.literal('item'),
      itemId: z.uuid(),
      productId: z.uuid().nullable(),
      ...amount,
    }),
    z.object({ type: z.literal('add'), query: querySchema }),
    z.object({ type: z.literal('remove'), itemId: z.uuid() }),
    z.object({ type: z.literal('refresh') }),
  ]),
});
export const confirmDraftSchema = draftRevisionSchema.extend({
  acknowledgeQuestions: z.boolean().default(false),
});
export type EditDraftInput = z.infer<typeof editDraftSchema>;
export type DraftTurnInput = z.infer<typeof draftTurnSchema>;
