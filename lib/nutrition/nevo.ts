import 'server-only';
import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '../../generated/prisma/client';
import type { z } from 'zod';
import { parseNevoCsv, type NevoRow } from './nevo-csv';
import { nevoApplySchema, nevoUploadSchema } from './nevo-schema';
import { productSearchFields } from './normalization';
import { productEmbeddingText } from './product-embedding-text';
import { enqueueProductIndex } from './product-index-queue';
import { calculateNutrition, NutritionCalculationError } from './calculations';

const source = { sourceType: 'DATASET', sourceName: 'NEVO' } as const;
const include = { servings: true } satisfies Prisma.ProductInclude;
type ExistingProduct = Prisma.ProductGetPayload<{ include: typeof include }>;
type Parsed = ReturnType<typeof parseNevoCsv>;
type Action = { kind: 'create' | 'update'; row: NevoRow; current: ExistingProduct | null };

function fields(row: NevoRow) {
  const product = row.product;
  return {
    name: product.name,
    aliases: product.aliases,
    description: product.description,
    referenceQuantity: product.referenceQuantity,
    referenceUnit: product.referenceUnit,
    referenceLabel: null,
    calories: product.calories,
    protein: product.protein,
    carbohydrates: product.carbohydrates,
    fat: product.fat,
    fiber: product.fiber,
    verificationStatus: product.verificationStatus,
  };
}
function sameFields(current: ExistingProduct, row: NevoRow, version: string) {
  const next = fields(row);
  const original = current.sourceSnapshot;
  if (
    !original ||
    typeof original !== 'object' ||
    Array.isArray(original) ||
    Object.keys(original).length !== Object.keys(row.original).length ||
    Object.entries(row.original).some(([key, value]) => original[key] !== value)
  ) {
    return false;
  }
  return (
    current.sourceVersion === version &&
    Object.entries(next).every(([key, value]) => {
      const stored = current[key as keyof typeof next];
      if (stored === null || value === null) {
        return stored === value;
      }
      return Array.isArray(value)
        ? JSON.stringify(stored) === JSON.stringify(value)
        : stored instanceof Prisma.Decimal
          ? stored.equals(value as string)
          : stored === value;
    })
  );
}
function compatible(current: ExistingProduct, row: NevoRow) {
  if (current.calculationMode !== 'DIRECT' || current.referenceUnit === 'SERVING') {
    return false;
  }
  for (const serving of current.servings) {
    try {
      calculateNutrition(
        { ...row.product, densityGramsPerMl: current.densityGramsPerMl?.toFixed() ?? null },
        {
          quantity: serving.quantity.toFixed(),
          unit: serving.canonicalUnit,
        }
      );
    } catch (error) {
      if (!(error instanceof NutritionCalculationError)) {
        throw error;
      }
      return false;
    }
  }
  return true;
}

function plan(
  userId: string,
  parsed: Parsed,
  existing: ExistingProduct[],
  overwriteEdited: boolean
) {
  const byCode = new Map(existing.map((product) => [product.sourceRecordId, product]));
  const codes = new Set(parsed.rows.map((row) => row.code));
  const actions: Action[] = [];
  let unchanged = 0,
    protectedEdits = 0,
    conversionConflicts = 0;
  const skipped: { code: string; name: string; reason: string }[] = [];
  for (const row of parsed.rows) {
    const current = byCode.get(row.code);
    if (!current) {
      actions.push({ kind: 'create', row, current: null });
    } else if (current.userModifiedAt && !overwriteEdited) {
      protectedEdits++;
      if (skipped.length < 10) {
        skipped.push({ code: row.code, name: current.name, reason: 'Manual edits are protected.' });
      }
    } else if (!compatible(current, row)) {
      conversionConflicts++;
      if (skipped.length < 10) {
        skipped.push({
          code: row.code,
          name: current.name,
          reason: 'Existing serving conversions are incompatible with this nutrition reference.',
        });
      }
    } else if (sameFields(current, row, parsed.version)) {
      unchanged++;
    } else {
      actions.push({ kind: 'update', row, current });
    }
  }
  const fingerprint = existing
    .map((product) => [
      product.id,
      product.version,
      product.sourceRecordId,
      product.userModifiedAt?.toISOString() ?? null,
      product.archivedAt?.toISOString() ?? null,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const summary = {
    version: parsed.version,
    total: parsed.rows.length,
    create: actions.filter((action) => action.kind === 'create').length,
    update: actions.filter((action) => action.kind === 'update').length,
    unchanged,
    protectedEdits,
    conversionConflicts,
    retained: existing.filter((product) => !codes.has(product.sourceRecordId!)).length,
    archived: existing.filter((product) => product.archivedAt && codes.has(product.sourceRecordId!))
      .length,
    samples: parsed.rows.slice(0, 5).map((row) => ({
      code: row.code,
      name: row.product.name,
      dutchName: row.product.aliases[0],
      calories: row.product.calories,
      referenceUnit: row.product.referenceUnit,
    })),
    skipped,
    planHash: createHash('sha256')
      .update(JSON.stringify({ userId, fileHash: parsed.fileHash, overwriteEdited, fingerprint }))
      .digest('hex'),
  };
  return { actions, summary };
}

export const nutritionNevo = {
  async preview(userId: string, raw: z.infer<typeof nevoUploadSchema>) {
    const input = nevoUploadSchema.parse(raw),
      parsed = parseNevoCsv(input.csv);
    const existing = await prisma.product.findMany({ where: { userId, ...source }, include });
    return plan(userId, parsed, existing, input.overwriteEdited).summary;
  },
  async apply(userId: string, raw: z.infer<typeof nevoApplySchema>) {
    const input = nevoApplySchema.parse(raw),
      parsed = parseNevoCsv(input.csv);
    return prisma.$transaction(
      async (db) => {
        const [claim] = await db.$queryRaw<
          { claimed: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(hashtextextended(${`nevo:${userId}`}, 0)) AS claimed`;
        if (!claim.claimed) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A NEVO import is already running for your account. Wait and preview again.',
          });
        }
        await db.$queryRaw`SELECT id FROM products WHERE "userId" = ${userId} AND "sourceType" = 'DATASET' AND "sourceName" = 'NEVO' ORDER BY id FOR UPDATE`;
        const existing = await db.product.findMany({ where: { userId, ...source }, include });
        const planned = plan(userId, parsed, existing, input.overwriteEdited);
        if (planned.summary.planHash !== input.planHash) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'Your NEVO foods changed after the preview. Preview the upload again before importing.',
          });
        }
        const importedAt = new Date();
        const created = planned.actions.filter((action) => action.kind === 'create');
        let needsIndex = created.length > 0;
        for (let offset = 0; offset < created.length; offset += 200) {
          await db.product.createMany({
            data: created.slice(offset, offset + 200).map(({ row }) => ({
              ...fields(row),
              ...productSearchFields(row.product),
              userId,
              ...source,
              sourceRecordId: row.code,
              sourceVersion: parsed.version,
              sourceSnapshot: row.original,
              importedAt,
            })),
          });
        }
        for (const { row, current } of planned.actions.filter(
          (action) => action.kind === 'update'
        )) {
          const changedText =
            productEmbeddingText(current!) !==
            productEmbeddingText({ ...row.product, brand: current!.brand });
          await db.product.update({
            where: { id: current!.id, userId },
            data: {
              ...fields(row),
              ...productSearchFields(row.product),
              sourceVersion: parsed.version,
              sourceSnapshot: row.original,
              importedAt,
              servingSizeQuantity: null,
              servingSizeUnit: null,
              servingSizeIsEstimated: false,
              version: { increment: 1 },
              ...(changedText
                ? {
                    searchUpdatedAt: new Date(
                      Math.max(Date.now(), current!.searchUpdatedAt.getTime() + 1)
                    ),
                  }
                : {}),
            },
          });
          needsIndex ||= changedText && !current!.archivedAt;
        }
        if (needsIndex) {
          await enqueueProductIndex(db, userId);
        }
        return planned.summary;
      },
      { timeout: 120_000 }
    );
  },
};
export type NevoImportPreview = Awaited<ReturnType<typeof nutritionNevo.preview>>;
