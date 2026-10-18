import 'server-only';
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '../../generated/prisma/client';
import { calculateNutrition } from './calculations';
import { normalizeProductText, productSearchFields } from './normalization';
import {
  productInputSchema,
  productSearchSchema,
  type ProductInput,
  type ProductSearchInput,
} from './schema';
import { searchProductIds } from './search';
import { searchHybridProductIds } from './product-search';
import { enqueueProductIndex } from './product-index-queue';
import { productEmbeddingText } from './product-embedding-text';
import { hybridProductSearchSchema, type HybridProductSearchInput } from './product-search-schema';
import type { NutritionDefinition, QuantityInput } from './types';

const includeServings = {
  servings: { orderBy: [{ isDefault: 'desc' }, { normalizedName: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ProductInclude;
type ProductRecord = Prisma.ProductGetPayload<{ include: typeof includeServings }>;

function definition(product: ProductRecord): NutritionDefinition {
  if (
    product.calculationMode !== 'DIRECT' ||
    product.calories === null ||
    product.protein === null ||
    product.carbohydrates === null ||
    product.fat === null
  ) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'This product needs a supported direct nutrition definition.',
    });
  }
  return {
    calculationMode: 'DIRECT',
    referenceQuantity: product.referenceQuantity.toFixed(),
    referenceUnit: product.referenceUnit,
    referenceLabel: product.referenceLabel,
    calories: product.calories.toFixed(),
    protein: product.protein.toFixed(),
    carbohydrates: product.carbohydrates.toFixed(),
    fat: product.fat.toFixed(),
    fiber: product.fiber?.toFixed() ?? null,
    servingSizeQuantity: product.servingSizeQuantity?.toFixed() ?? null,
    servingSizeUnit:
      product.servingSizeUnit === 'G' || product.servingSizeUnit === 'ML'
        ? product.servingSizeUnit
        : null,
    servingSizeIsEstimated: product.servingSizeIsEstimated,
    densityGramsPerMl: product.densityGramsPerMl?.toFixed() ?? null,
    densityIsEstimated: product.densityIsEstimated,
    servings: product.servings.map((serving) => ({
      id: serving.id,
      name: serving.name,
      aliases: serving.aliases,
      quantity: serving.quantity.toFixed(),
      canonicalUnit: serving.canonicalUnit,
      isDefault: serving.isDefault,
      isEstimated: serving.isEstimated,
    })),
  };
}

function serialize(product: ProductRecord) {
  return {
    ...definition(product),
    id: product.id,
    name: product.name,
    brand: product.brand,
    description: product.description,
    aliases: product.aliases,
    sourceType: product.sourceType,
    sourceName: product.sourceName,
    sourceRecordId: product.sourceRecordId,
    sourceVersion: product.sourceVersion,
    importedAt: product.importedAt,
    verificationStatus: product.verificationStatus,
    userModifiedAt: product.userModifiedAt,
    archivedAt: product.archivedAt,
    version: product.version,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}
export type NutritionProduct = ReturnType<typeof serialize>;

function prepare(rawInput: ProductInput) {
  const input = productInputSchema.parse(rawInput);
  for (const serving of input.servings) {
    // Check every configured conversion through the same calculation path as previews/logging.
    calculateNutrition(input, { quantity: serving.quantity, unit: serving.canonicalUnit });
  }
  const { servings, ...fields } = input;
  return {
    servings,
    data: {
      ...fields,
      brand: fields.brand || null,
      description: fields.description || null,
      referenceLabel: fields.referenceUnit === 'SERVING' ? fields.referenceLabel : null,
      ...productSearchFields(input),
    },
  };
}

async function owned(db: Prisma.TransactionClient, userId: string, id: string, lock = false) {
  if (lock) {
    await db.$queryRaw`SELECT id FROM products WHERE id = ${id}::uuid AND "userId" = ${userId} FOR UPDATE`;
  }
  const product = await db.product.findFirst({ where: { id, userId }, include: includeServings });
  if (!product) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found.' });
  }
  return product;
}

function requireVersion(product: ProductRecord, version: number) {
  if (product.version !== version) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'This product changed. Reopen it to load the latest version.',
    });
  }
}

function servingData(serving: ProductInput['servings'][number]) {
  const { id: _id, ...data } = serving;
  return { ...data, normalizedName: normalizeProductText(data.name) };
}

export const nutritionProducts = {
  async search(userId: string, rawInput: HybridProductSearchInput, signal?: AbortSignal) {
    const input = hybridProductSearchSchema.parse(rawInput);
    const found = await searchHybridProductIds(userId, input, signal);
    const products = await prisma.product.findMany({
      where: { userId, id: { in: found.matches.map((match) => match.id) }, archivedAt: null },
      include: includeServings,
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    return {
      ...found,
      matches: found.matches.flatMap((match) => {
        const product = byId.get(match.id);
        return product ? [{ ...match, product: serialize(product) }] : [];
      }),
    };
  },
  async list(userId: string, rawInput: ProductSearchInput) {
    const input = productSearchSchema.parse(rawInput);
    const found = await searchProductIds(userId, input);
    const products = await prisma.product.findMany({
      where: { userId, id: { in: found.ids }, archivedAt: input.archived ? { not: null } : null },
      include: includeServings,
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    return {
      products: found.ids.flatMap((id) => (byId.has(id) ? [serialize(byId.get(id)!)] : [])),
      total: found.total,
    };
  },

  async get(userId: string, id: string, db: Prisma.TransactionClient = prisma) {
    return serialize(await owned(db, userId, id));
  },

  async create(userId: string, rawInput: ProductInput) {
    const { data, servings } = prepare(rawInput);
    if (servings.some((serving) => serving.id)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'New products cannot reuse existing serving IDs.',
      });
    }
    return prisma.$transaction(async (db) => {
      const product = await db.product.create({
        data: {
          ...data,
          userId,
          sourceType: 'MANUAL',
          servings: { create: servings.map(servingData) },
        },
        include: includeServings,
      });
      await enqueueProductIndex(db, userId);
      return serialize(product);
    });
  },

  async update(userId: string, id: string, version: number, rawInput: ProductInput) {
    const { data, servings } = prepare(rawInput);
    return prisma.$transaction(async (db) => {
      const current = await owned(db, userId, id, true);
      requireVersion(current, version);
      const searchChanged = productEmbeddingText(current) !== productEmbeddingText(data);
      if (current.archivedAt) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Restore this product before editing it.',
        });
      }
      const existing = new Set(current.servings.map((serving) => serving.id));
      if (servings.some((serving) => serving.id && !existing.has(serving.id))) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A serving does not belong to this product.',
        });
      }
      const kept = new Set(servings.flatMap((serving) => (serving.id ? [serving.id] : [])));
      const removed = [...existing].filter((servingId) => !kept.has(servingId));
      if (
        removed.length &&
        (await db.productComponent.count({
          where: { childProductId: id, servingId: { in: removed } },
        }))
      ) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A serving is used by another product. Remove that component reference first.',
        });
      }
      // Clear uniqueness-bearing values before replacing them, allowing default/name swaps.
      await db.productServing.updateMany({ where: { productId: id }, data: { isDefault: false } });
      const editNamespace = randomUUID();
      for (const serving of current.servings) {
        await db.productServing.update({
          where: { id: serving.id },
          data: { normalizedName: `${editNamespace}:${serving.id}` },
        });
      }
      await db.productServing.deleteMany({ where: { productId: id, id: { in: removed } } });
      for (const serving of servings) {
        if (serving.id) {
          await db.productServing.update({ where: { id: serving.id }, data: servingData(serving) });
        } else {
          await db.productServing.create({ data: { ...servingData(serving), productId: id } });
        }
      }
      const product = await db.product.update({
        where: { id, userId },
        data: {
          ...data,
          version: { increment: 1 },
          userModifiedAt: new Date(),
          ...(searchChanged
            ? {
                searchUpdatedAt: new Date(
                  Math.max(Date.now(), current.searchUpdatedAt.getTime() + 1)
                ),
              }
            : {}),
        },
        include: includeServings,
      });
      if (searchChanged) {
        await enqueueProductIndex(db, userId);
      }
      return serialize(product);
    });
  },

  async setArchived(userId: string, id: string, version: number, archived: boolean) {
    return prisma.$transaction(async (db) => {
      const current = await owned(db, userId, id, true);
      requireVersion(current, version);
      if (
        archived &&
        (await db.productComponent.count({
          where: {
            childProductId: id,
            parentProduct: { archivedAt: null, calculationMode: 'CALCULATED' },
          },
        }))
      ) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'This product is used by an active calculated product. Update that product first.',
        });
      }
      const product = await db.product.update({
        where: { id, userId },
        data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } },
        include: includeServings,
      });
      if (archived) {
        await db.productEmbedding.deleteMany({ where: { productId: id } });
      }
      await enqueueProductIndex(db, userId);
      return serialize(product);
    });
  },

  async calculate(userId: string, id: string, input: QuantityInput) {
    const product = await owned(prisma, userId, id);
    return { ...calculateNutrition(definition(product), input), productVersion: product.version };
  },
};
