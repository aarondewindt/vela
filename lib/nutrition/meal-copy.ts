import 'server-only';
import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '../../generated/prisma/client';
import { diaryDate } from './dates';
import { copyMealSchema, type CopyMealInput } from './reuse-schema';
import { readNutritionSnapshot } from './snapshots';

function copiedRequestId(requestId: string, entryId: string) {
  const hex = createHash('sha256').update(`meal-copy:${requestId}:${entryId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function copyNutritionMeal(userId: string, raw: CopyMealInput) {
  const input = copyMealSchema.parse(raw);
  const entries = [...input.entries].sort((a, b) => a.id.localeCompare(b.id));
  const hash = createHash('sha256')
    .update(JSON.stringify({ ...input, entries }))
    .digest('hex');
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`nutrition-copy:${userId}:${input.requestId}`}, 0))::text`;
    const receipt = await db.nutritionMealCopy.findUnique({
      where: { userId_requestId: { userId, requestId: input.requestId } },
    });
    if (receipt) {
      if (receipt.requestHash !== hash) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This copy request was already used. Reopen the copy form.',
        });
      }
      return { entryIds: receipt.entryIds, date: input.targetDate };
    }
    // Lock the reviewed source rows so concurrent quantity edits cannot slip into a copy.
    await db.$queryRaw(
      Prisma.sql`SELECT id FROM nutrition_log_entries WHERE "userId" = ${userId} AND id IN (${Prisma.join(entries.map((entry) => Prisma.sql`${entry.id}::uuid`))}) ORDER BY id FOR SHARE`
    );
    const sources = await db.nutritionLogEntry.findMany({
      where: {
        userId,
        id: { in: entries.map((entry) => entry.id) },
        logDate: diaryDate(input.sourceDate),
        mealCategory: input.sourceMeal,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (
      sources.length !== entries.length ||
      sources.some(
        (source) => entries.find((entry) => entry.id === source.id)?.version !== source.version
      )
    ) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'The source meal changed. Reload and review it before copying.',
      });
    }
    const entryIds: string[] = [];
    for (const source of sources) {
      const snapshot = readNutritionSnapshot(source.referenceSnapshot);
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...fields } = source;
      const entry = await db.nutritionLogEntry.create({
        data: {
          ...fields,
          logDate: diaryDate(input.targetDate),
          mealCategory: input.targetMeal,
          referenceSnapshot: snapshot,
          version: 1,
          requestId: copiedRequestId(input.requestId, source.id),
          requestHash: hash,
        },
      });
      entryIds.push(entry.id);
    }
    await db.nutritionMealCopy.create({
      data: {
        userId,
        requestId: input.requestId,
        requestHash: hash,
        entryIds,
        targetDate: diaryDate(input.targetDate),
      },
    });
    return { entryIds, date: input.targetDate };
  });
}
