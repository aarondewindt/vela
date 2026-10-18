import 'server-only';
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import { requireModelSelection } from '@/lib/model-settings/service';
import { resolveChatModel } from '@/lib/ai';
import type { ModelSelection } from '@/lib/model-settings/schema';
import { Prisma } from '../../generated/prisma/client';
import { diaryDate, dateInTimezone } from './dates';
import { nutritionProducts, type NutritionProduct } from './products';
import { lockProductGraph } from './product-graph';
import { createNutritionLogEntry } from './diary';
import {
  applyDraftInterpretation,
  newDraftItem,
  previewDraftItems,
  withDraftProduct,
} from './draft-items';
import { matchDraftItem } from './draft-matching';
import {
  createDraftSchema,
  draftItemsSchema,
  editDraftSchema,
  draftTurnSchema,
  confirmDraftSchema,
  type DraftItem,
  type DraftInterpretation,
  type DraftTurnInput,
  type EditDraftInput,
} from './draft-schema';
import type { z } from 'zod';

const include = {
  turns: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 40 },
} satisfies Prisma.NutritionMealDraftInclude;
type DraftRecord = Prisma.NutritionMealDraftGetPayload<{ include: typeof include }>;
const generationLeaseMs = 180_000;

function conflict(message = 'This draft changed. Reload it before trying again.'): never {
  throw new TRPCError({ code: 'CONFLICT', message });
}
function serialize(draft: DraftRecord) {
  return {
    id: draft.id,
    title: draft.title,
    date: draft.logDate.toISOString().slice(0, 10),
    mealCategory: draft.mealCategory,
    status: draft.status,
    revision: draft.revision,
    selection: { provider: 'ollama' as const, modelId: draft.modelId },
    override: draft.inheritsModel ? null : { provider: 'ollama' as const, modelId: draft.modelId },
    generating: Boolean(
      draft.generationId && draft.generationExpiresAt && draft.generationExpiresAt > new Date()
    ),
    questions: draft.questions,
    confirmedEntryIds: draft.confirmedEntryIds,
    ...previewDraftItems(draft.items),
    turns: draft.turns.map((turn) => ({
      id: turn.id,
      userText: turn.userText,
      assistantText: turn.assistantText,
      status: turn.status,
      error: turn.error,
      provider: turn.provider,
      modelId: turn.modelId,
    })),
  };
}
export type MealDraft = ReturnType<typeof serialize>;

async function owned(db: Prisma.TransactionClient, userId: string, id: string) {
  await db.$queryRaw`SELECT id FROM nutrition_meal_drafts WHERE id = ${id}::uuid AND "userId" = ${userId} FOR UPDATE`;
  let draft = await db.nutritionMealDraft.findFirst({ where: { id, userId }, include });
  if (!draft) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Meal draft not found.' });
  }
  if (draft.generationId && draft.generationExpiresAt && draft.generationExpiresAt <= new Date()) {
    await db.nutritionDraftTurn.updateMany({
      where: { draftId: id, status: 'GENERATING' },
      data: {
        status: 'FAILED',
        error: 'Interpretation was interrupted. Retry your message or edit the draft manually.',
      },
    });
    draft = await db.nutritionMealDraft.update({
      where: { id, userId },
      data: { generationId: null, generationExpiresAt: null, revision: { increment: 1 } },
      include,
    });
  }
  return draft;
}
function mutable(draft: DraftRecord, revision: number) {
  if (draft.status !== 'DRAFT') {
    conflict('This draft has already been confirmed or discarded.');
  }
  if (draft.revision !== revision) {
    conflict();
  }
}
async function interrupt(db: Prisma.TransactionClient, draftId: string) {
  await db.nutritionDraftTurn.updateMany({
    where: { draftId, status: 'GENERATING' },
    data: { status: 'FAILED', error: 'Interpretation was superseded by a manual change.' },
  });
}
async function refreshedItems(db: Prisma.TransactionClient, userId: string, items: DraftItem[]) {
  await lockProductGraph(db, userId);
  const ids = [
    ...new Set(items.flatMap((item) => (item.snapshot ? [item.snapshot.productId] : []))),
  ].sort();
  const products = new Map<string, NutritionProduct>();
  for (const id of ids) {
    await db.$queryRaw`SELECT id FROM products WHERE id = ${id}::uuid AND "userId" = ${userId} FOR SHARE`;
    try {
      products.set(id, await nutritionProducts.get(userId, id, db));
    } catch (error) {
      if (!(error instanceof TRPCError && error.code === 'NOT_FOUND')) {
        throw error;
      }
    }
  }
  let changed = false;
  const next = items.map((item) => {
    if (!item.snapshot) {
      return item;
    }
    const product = products.get(item.snapshot.productId);
    if (
      !product ||
      product.archivedAt ||
      product.version !== item.snapshot.productVersion ||
      product.recipeRevision !==
        ('recipeRevision' in item.snapshot ? item.snapshot.recipeRevision : undefined)
    ) {
      changed = true;
      return withDraftProduct(item, product && !product.archivedAt ? product : null);
    }
    return item;
  });
  return { items: next, changed };
}

export const nutritionDrafts = {
  list(userId: string) {
    return prisma.nutritionMealDraft.findMany({
      where: { userId, status: 'DRAFT' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: 20,
      select: { id: true, title: true, logDate: true, mealCategory: true, updatedAt: true },
    });
  },
  get(userId: string, id: string) {
    return prisma.$transaction(async (db) => serialize(await owned(db, userId, id)));
  },
  async create(userId: string, raw: z.infer<typeof createDraftSchema>) {
    const input = createDraftSchema.parse(raw);
    return prisma.$transaction(async (db) => {
      const existing = await db.nutritionMealDraft.findUnique({ where: { id: input.id } });
      if (existing) {
        if (existing.userId !== userId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Meal draft not found.' });
        }
        return serialize(await owned(db, userId, input.id));
      }
      if ((await db.nutritionMealDraft.count({ where: { userId, status: 'DRAFT' } })) >= 20) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Finish or discard an existing meal draft before creating another (maximum 20 open drafts).',
        });
      }
      const selection = await requireModelSelection(
        userId,
        'nutrition.mealDraft',
        input.selection,
        db
      );
      return serialize(
        await db.nutritionMealDraft.create({
          data: {
            id: input.id,
            userId,
            logDate: diaryDate(input.date),
            mealCategory: input.mealCategory,
            provider: selection.provider,
            modelId: selection.modelId,
            inheritsModel: !input.selection,
          },
          include,
        })
      );
    });
  },
  async changeModel(
    userId: string,
    id: string,
    revision: number,
    selection: ModelSelection | null
  ) {
    await nutritionDrafts.get(userId, id);
    if (selection) {
      await resolveChatModel(selection);
    }
    return prisma.$transaction(async (db) => {
      const draft = await owned(db, userId, id);
      mutable(draft, revision);
      if (draft.generationId) {
        conflict('Wait for the active interpretation to finish before changing models.');
      }
      return serialize(
        await db.nutritionMealDraft.update({
          where: { id, userId },
          data: { inheritsModel: !selection, ...(selection ?? {}), revision: { increment: 1 } },
          include,
        })
      );
    });
  },
  async edit(userId: string, raw: EditDraftInput) {
    const input = editDraftSchema.parse(raw);
    return prisma.$transaction(async (db) => {
      const draft = await owned(db, userId, input.id);
      mutable(draft, input.revision);
      let items = draftItemsSchema.parse(draft.items);
      let logDate = draft.logDate;
      let mealCategory = draft.mealCategory;
      const change = input.change;
      if (change.type === 'header') {
        logDate = diaryDate(change.date);
        mealCategory = change.mealCategory;
      } else if (change.type === 'add') {
        if (items.length >= 40) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'A draft supports up to 40 foods.' });
        }
        items.push(newDraftItem(change.query));
      } else if (change.type === 'refresh') {
        items = (await refreshedItems(db, userId, items)).items;
      } else {
        const index = items.findIndex((item) => item.id === change.itemId);
        if (index < 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft item not found.' });
        }
        if (change.type === 'remove') {
          items.splice(index, 1);
        } else {
          const product = change.productId
            ? await nutritionProducts.get(userId, change.productId, db)
            : null;
          items[index] = withDraftProduct(
            { ...items[index], quantity: change.quantity, unit: change.unit },
            product
          );
        }
      }
      await interrupt(db, draft.id);
      return serialize(
        await db.nutritionMealDraft.update({
          where: { id: draft.id, userId },
          data: {
            items: draftItemsSchema.parse(items),
            logDate,
            mealCategory,
            revision: { increment: 1 },
            generationId: null,
            generationExpiresAt: null,
          },
          include,
        })
      );
    });
  },
  async discard(userId: string, id: string, revision: number) {
    return prisma.$transaction(async (db) => {
      const draft = await owned(db, userId, id);
      mutable(draft, revision);
      await interrupt(db, id);
      await db.nutritionMealDraft.update({
        where: { id, userId },
        data: {
          status: 'DISCARDED',
          revision: { increment: 1 },
          generationId: null,
          generationExpiresAt: null,
        },
      });
      return { discarded: true };
    });
  },
  async beginTurn(userId: string, raw: DraftTurnInput) {
    const input = draftTurnSchema.parse(raw);
    return prisma.$transaction(async (db) => {
      const draft = await owned(db, userId, input.id);
      const existing = draft.turns.find((turn) => turn.id === input.requestId);
      if (existing && existing.userText !== input.text) {
        conflict('This message ID was already used for different text.');
      }
      if (existing?.status === 'COMPLETED') {
        return { generationId: null };
      }
      if (
        existing &&
        draft.turns.some(
          (turn) =>
            turn.status === 'COMPLETED' && turn.requestedRevision > existing.requestedRevision
        )
      ) {
        conflict(
          'This message has a newer correction. Send a new message instead of retrying an older one.'
        );
      }
      mutable(draft, input.revision);
      if (draft.generationId) {
        conflict(
          'A message is already being interpreted. Wait or edit the draft manually to supersede it.'
        );
      }
      if (!existing && draft.turns.length >= 40) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'This draft has reached 40 messages. Finish it manually or create another draft.',
        });
      }
      const generationId = randomUUID();
      const selection = await requireModelSelection(
        userId,
        'nutrition.mealDraft',
        draft.inheritsModel
          ? null
          : {
              provider: 'ollama',
              modelId: draft.modelId,
            },
        db
      );
      const revision = draft.revision + 1;
      const saved = await db.nutritionMealDraft.update({
        where: { id: draft.id, userId },
        data: {
          generationId,
          generationExpiresAt: new Date(Date.now() + generationLeaseMs),
          revision,
          ...(draft.turns.length === 0 ? { title: input.text.slice(0, 120) } : {}),
        },
        include,
      });
      const data = {
        status: 'GENERATING' as const,
        assistantText: null,
        error: null,
        requestedRevision: revision,
        provider: selection.provider,
        modelId: selection.modelId,
      };
      if (existing) {
        await db.nutritionDraftTurn.update({ where: { id: existing.id, draftId: draft.id }, data });
      } else {
        await db.nutritionDraftTurn.create({
          data: { ...data, id: input.requestId, draftId: draft.id, userText: input.text },
        });
      }
      const preferences = await db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { timezone: true },
      });
      return {
        generationId,
        revision,
        selection,
        timezone: preferences.timezone,
        today: dateInTimezone(preferences.timezone),
        current: {
          items: draftItemsSchema.parse(saved.items),
          date: saved.logDate.toISOString().slice(0, 10),
          mealCategory: saved.mealCategory,
        },
        history: draft.turns.slice(-8).map((turn) => ({
          user: turn.userText,
          assistant: turn.assistantText,
          status: turn.status,
        })),
      };
    });
  },
  async finishTurn(
    userId: string,
    input: DraftTurnInput,
    generationId: string,
    revision: number,
    result: DraftInterpretation,
    current: { items: DraftItem[]; date: string; mealCategory: DraftRecord['mealCategory'] },
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    const next = await applyDraftInterpretation(current, result, (item) =>
      matchDraftItem(userId, item, signal)
    );
    signal?.throwIfAborted();
    await prisma.$transaction(async (db) => {
      const draft = await owned(db, userId, input.id);
      if (
        draft.status !== 'DRAFT' ||
        draft.generationId !== generationId ||
        draft.revision !== revision
      ) {
        conflict('This response was superseded. Reload the saved draft.');
      }
      await db.nutritionMealDraft.update({
        where: { id: draft.id, userId },
        data: {
          items: next.items,
          logDate: diaryDate(next.date),
          mealCategory: next.mealCategory,
          questions: next.questions,
          generationId: null,
          generationExpiresAt: null,
          revision: { increment: 1 },
        },
      });
      await db.nutritionDraftTurn.update({
        where: { id: input.requestId, draftId: draft.id },
        data: { status: 'COMPLETED', assistantText: next.reply, error: null },
      });
    });
    return nutritionDrafts.get(userId, input.id);
  },
  async failTurn(userId: string, id: string, requestId: string, generationId: string) {
    await prisma.$transaction(async (db) => {
      const updated = await db.nutritionMealDraft.updateMany({
        where: { id, userId, generationId, status: 'DRAFT' },
        data: { generationId: null, generationExpiresAt: null, revision: { increment: 1 } },
      });
      if (updated.count) {
        await db.nutritionDraftTurn.updateMany({
          where: { id: requestId, draftId: id, status: 'GENERATING' },
          data: {
            status: 'FAILED',
            error:
              'Interpretation failed or was interrupted. Your draft was preserved; retry or edit it manually.',
          },
        });
      }
    });
  },
  async confirm(userId: string, raw: z.infer<typeof confirmDraftSchema>) {
    const input = confirmDraftSchema.parse(raw);
    return prisma.$transaction(
      async (db) => {
        const draft = await owned(db, userId, input.id);
        if (draft.status === 'CONFIRMED') {
          return {
            confirmed: true as const,
            date: draft.logDate.toISOString().slice(0, 10),
            entryIds: draft.confirmedEntryIds,
          };
        }
        mutable(draft, input.revision);
        if (draft.generationId) {
          conflict('Wait for interpretation to finish before confirming.');
        }
        const refreshed = await refreshedItems(db, userId, draftItemsSchema.parse(draft.items));
        if (refreshed.changed) {
          await db.nutritionMealDraft.update({
            where: { id: draft.id, userId },
            data: { items: refreshed.items, revision: { increment: 1 } },
          });
          return {
            confirmed: false as const,
            notice:
              'Some food definitions changed or are unavailable. Review the refreshed draft and confirm again.',
          };
        }
        const preview = previewDraftItems(refreshed.items);
        if (!preview.items.length || preview.unresolved) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Resolve every food, quantity and unit before confirming.',
          });
        }
        if (draft.questions.length && !input.acknowledgeQuestions) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Review and acknowledge the interpretation questions before confirming.',
          });
        }
        const entryIds: string[] = [];
        for (const item of preview.items) {
          const entry = await createNutritionLogEntry(db, userId, {
            requestId: item.id,
            productId: item.snapshot!.productId,
            productVersion: item.snapshot!.productVersion,
            ...('recipeRevision' in item.snapshot!
              ? { recipeRevision: item.snapshot.recipeRevision }
              : {}),
            logDate: draft.logDate.toISOString().slice(0, 10),
            mealCategory: draft.mealCategory,
            input: item.input!,
          });
          entryIds.push(entry.id);
        }
        await db.nutritionMealDraft.update({
          where: { id: draft.id, userId },
          data: {
            status: 'CONFIRMED',
            confirmedEntryIds: entryIds,
            confirmedAt: new Date(),
            revision: { increment: 1 },
          },
        });
        return {
          confirmed: true as const,
          date: draft.logDate.toISOString().slice(0, 10),
          entryIds,
        };
      },
      { timeout: 30_000 }
    );
  },
};
