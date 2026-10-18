import 'server-only';
import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import { Prisma, type NutritionLogEntry } from '../../generated/prisma/client';
import { nutritionProducts } from './products';
import { nutritionGoals } from './goals';
import { lockProductGraph } from './product-graph';
import { diaryDate } from './dates';
import {
  calculateSnapshotNutrition,
  captureNutritionSnapshot,
  readNutritionSnapshot,
} from './snapshots';
import { sumNutrition, nutritionGoalProgress } from './calculations';
import {
  createLogEntrySchema,
  updateLogEntrySchema,
  type CreateLogEntryInput,
  type UpdateLogEntryInput,
} from './diary-schema';
import type { QuantityInput } from './types';

function serializeEntry(entry: NutritionLogEntry) {
  return {
    id: entry.id,
    productId: entry.productId,
    logDate: entry.logDate.toISOString().slice(0, 10),
    mealCategory: entry.mealCategory,
    productName: entry.productNameSnapshot,
    quantity: entry.quantity.toFixed(),
    unit: entry.unit,
    servingId: entry.servingId,
    unitLabel: entry.unitLabelSnapshot,
    estimated: entry.estimated,
    version: entry.version,
    nutrients: {
      calories: entry.calories.toFixed(),
      protein: entry.protein.toFixed(),
      carbohydrates: entry.carbohydrates.toFixed(),
      fat: entry.fat.toFixed(),
      fiber: entry.fiber?.toFixed() ?? null,
    },
    snapshot: readNutritionSnapshot(entry.referenceSnapshot),
  };
}
export type DiaryEntry = ReturnType<typeof serializeEntry>;

async function ownedEntry(db: Prisma.TransactionClient, userId: string, id: string, lock = false) {
  if (lock) {
    await db.$queryRaw`SELECT id FROM nutrition_log_entries WHERE id = ${id}::uuid AND "userId" = ${userId} FOR UPDATE`;
  }
  const entry = await db.nutritionLogEntry.findFirst({ where: { id, userId } });
  if (!entry) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Diary entry not found.' });
  }
  return entry;
}

function assertVersion(entry: NutritionLogEntry, version: number) {
  if (entry.version !== version) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'This diary entry changed. Reopen it before saving again.',
    });
  }
}

function replay(entry: NutritionLogEntry, hash: string) {
  if (entry.requestHash !== hash) {
    throw new TRPCError({
      code: 'CONFLICT',
      message:
        'This logging request was already used for a different entry. Reopen the form to add another food.',
    });
  }
  return serializeEntry(entry);
}

/** Shared transactional logging path for manual entry and confirmed meal drafts. */
export async function createNutritionLogEntry(
  db: Prisma.TransactionClient,
  userId: string,
  rawInput: CreateLogEntryInput
) {
  const input = createLogEntrySchema.parse(rawInput);
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const where = { userId_requestId: { userId, requestId: input.requestId } };
  const existing = await db.nutritionLogEntry.findUnique({ where });
  if (existing) {
    return replay(existing, hash);
  }
  await lockProductGraph(db, userId);
  // Product edits/serving edits lock this same row exclusively. Capture one consistent source.
  await db.$queryRaw`SELECT id FROM products WHERE id = ${input.productId}::uuid AND "userId" = ${userId} FOR SHARE`;
  const product = await nutritionProducts.get(userId, input.productId, db);
  if (product.archivedAt) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Choose an active product to log new food.',
    });
  }
  if (product.version !== input.productVersion || product.recipeRevision !== input.recipeRevision) {
    throw new TRPCError({
      code: 'CONFLICT',
      message:
        'This product changed. Refresh the selected product and review its nutrition before saving.',
    });
  }
  const snapshot = captureNutritionSnapshot(product);
  const calculation = calculateSnapshotNutrition(snapshot, input.input);
  const entry = await db.nutritionLogEntry.upsert({
    where,
    update: {},
    create: {
      userId,
      productId: product.id,
      logDate: diaryDate(input.logDate),
      mealCategory: input.mealCategory,
      productNameSnapshot: product.name,
      quantity: input.input.quantity,
      unit: input.input.unit,
      servingId: input.input.servingId ?? null,
      unitLabelSnapshot: calculation.unitLabel,
      resolvedQuantity: calculation.resolvedQuantity,
      referenceUnit: calculation.referenceUnit,
      ...calculation.nutrients,
      estimated: calculation.estimated,
      referenceSnapshot: snapshot,
      requestId: input.requestId,
      requestHash: hash,
    },
  });
  return replay(entry, hash);
}

export const nutritionDiary = {
  async day(userId: string, date: string) {
    const [records, goals] = await Promise.all([
      prisma.nutritionLogEntry.findMany({
        where: { userId, logDate: diaryDate(date) },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      nutritionGoals.get(userId),
    ]);
    const entries = records.map(serializeEntry);
    const totals = sumNutrition(entries.map((entry) => entry.nutrients));
    return { date, entries, totals, goals, progress: nutritionGoalProgress(totals, goals) };
  },

  async create(userId: string, rawInput: CreateLogEntryInput) {
    const input = createLogEntrySchema.parse(rawInput);
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const where = { userId_requestId: { userId, requestId: input.requestId } };
    try {
      return await prisma.$transaction((db) => createNutritionLogEntry(db, userId, input));
    } catch (error) {
      // Also handle connectors/Prisma paths that implement upsert with separate statements.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.nutritionLogEntry.findUnique({ where });
        if (existing) {
          return replay(existing, hash);
        }
      }
      throw error;
    }
  },

  async update(userId: string, rawInput: UpdateLogEntryInput) {
    const input = updateLogEntrySchema.parse(rawInput);
    return prisma.$transaction(async (db) => {
      const entry = await ownedEntry(db, userId, input.id, true);
      assertVersion(entry, input.version);
      // Never fetch Product or ProductServing here: historical values are authoritative.
      const calculation = calculateSnapshotNutrition(entry.referenceSnapshot, input.input);
      return serializeEntry(
        await db.nutritionLogEntry.update({
          where: { id: entry.id, userId },
          data: {
            logDate: diaryDate(input.logDate),
            mealCategory: input.mealCategory,
            quantity: input.input.quantity,
            unit: input.input.unit,
            servingId: input.input.servingId ?? null,
            unitLabelSnapshot: calculation.unitLabel,
            resolvedQuantity: calculation.resolvedQuantity,
            ...calculation.nutrients,
            estimated: calculation.estimated,
            version: { increment: 1 },
          },
        })
      );
    });
  },

  async preview(userId: string, id: string, input: QuantityInput) {
    const entry = await ownedEntry(prisma, userId, id);
    return calculateSnapshotNutrition(entry.referenceSnapshot, input);
  },

  async remove(userId: string, id: string, version: number) {
    return prisma.$transaction(async (db) => {
      const entry = await ownedEntry(db, userId, id, true);
      assertVersion(entry, version);
      await db.nutritionLogEntry.delete({ where: { id, userId } });
      return { deleted: true };
    });
  },
};
