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
import type { QuantityInput } from './types';
import {
  productInclude as includeServings,
  type ProductRecord,
  loadProductGraph,
  resolvedProduct,
  lockProductGraph,
  validateProductDependents,
  validateComponentInputs,
} from './product-graph';

async function serializeMany(
  db: Prisma.TransactionClient,
  userId: string,
  products: ProductRecord[]
) {
  const graph = await loadProductGraph(db, userId, products);
  return products.map((product) => resolvedProduct(product, graph));
}
export type NutritionProduct = ReturnType<typeof resolvedProduct>;

function prepare(rawInput: ProductInput) {
  const input = productInputSchema.parse(rawInput);
  for (const serving of input.servings) {
    // Check every configured conversion through the same calculation path as previews/logging.
    calculateNutrition(input, { quantity: serving.quantity, unit: serving.canonicalUnit });
  }
  const { servings, components = [], ...fields } = input;
  return {
    servings,
    components,
    data: {
      ...fields,
      yieldQuantity: fields.yieldQuantity ?? null,
      yieldUnit: fields.yieldUnit ?? null,
      ...(fields.calculationMode === 'CALCULATED'
        ? { calories: null, protein: null, carbohydrates: null, fat: null, fiber: null }
        : {}),
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
    return prisma.$transaction(
      async (db) => {
        const products = await db.product.findMany({
          where: { userId, id: { in: found.matches.map((match) => match.id) }, archivedAt: null },
          include: includeServings,
        });
        const graph = await loadProductGraph(db, userId, products);
        const byId = new Map(products.map((product) => [product.id, product]));
        return {
          ...found,
          matches: found.matches.flatMap((match) => {
            const product = byId.get(match.id);
            return product ? [{ ...match, product: resolvedProduct(product, graph) }] : [];
          }),
        };
      },
      { isolationLevel: 'RepeatableRead' }
    );
  },
  async list(userId: string, rawInput: ProductSearchInput) {
    const input = productSearchSchema.parse(rawInput);
    const found = await searchProductIds(userId, input);
    return prisma.$transaction(
      async (db) => {
        const products = await db.product.findMany({
          where: {
            userId,
            id: { in: found.ids },
            archivedAt: input.archived ? { not: null } : null,
          },
          include: includeServings,
        });
        const graph = await loadProductGraph(db, userId, products);
        const byId = new Map(products.map((product) => [product.id, product]));
        return {
          products: found.ids.flatMap((id) =>
            byId.has(id) ? [resolvedProduct(byId.get(id)!, graph)] : []
          ),
          total: found.total,
        };
      },
      { isolationLevel: 'RepeatableRead' }
    );
  },

  async get(userId: string, id: string, db?: Prisma.TransactionClient): Promise<NutritionProduct> {
    const read = async (transaction: Prisma.TransactionClient) => {
      const product = await owned(transaction, userId, id);
      return (await serializeMany(transaction, userId, [product]))[0];
    };
    return db ? read(db) : prisma.$transaction(read, { isolationLevel: 'RepeatableRead' });
  },

  async create(userId: string, rawInput: ProductInput) {
    const { data, servings, components } = prepare(rawInput);
    if (servings.some((serving) => serving.id)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'New products cannot reuse existing serving IDs.',
      });
    }
    return prisma.$transaction(async (db) => {
      await lockProductGraph(db, userId);
      await validateComponentInputs(db, userId, components);
      const product = await db.product.create({
        data: {
          ...data,
          userId,
          sourceType: 'MANUAL',
          servings: { create: servings.map(servingData) },
        },
        include: includeServings,
      });
      if (components.length) {
        await db.productComponent.createMany({
          data: components.map((component, sortOrder) => ({
            ...component,
            userId,
            parentProductId: product.id,
            sortOrder,
          })),
        });
      }
      await enqueueProductIndex(db, userId);
      return (
        await serializeMany(db, userId, [
          components.length ? await owned(db, userId, product.id) : product,
        ])
      )[0];
    });
  },

  async update(userId: string, id: string, version: number, rawInput: ProductInput) {
    const { data, servings, components } = prepare(rawInput);
    return prisma.$transaction(async (db) => {
      await lockProductGraph(db, userId);
      const current = await owned(db, userId, id, true);
      requireVersion(current, version);
      await validateComponentInputs(db, userId, components, id);
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
      await db.productComponent.deleteMany({ where: { parentProductId: id, userId } });
      if (components.length) {
        await db.productComponent.createMany({
          data: components.map((component, sortOrder) => ({
            ...component,
            userId,
            parentProductId: id,
            sortOrder,
          })),
        });
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
      await validateProductDependents(db, userId, [id]);
      return (await serializeMany(db, userId, [product]))[0];
    });
  },

  async setArchived(userId: string, id: string, version: number, archived: boolean) {
    return prisma.$transaction(async (db) => {
      await lockProductGraph(db, userId);
      const current = await owned(db, userId, id, true);
      requireVersion(current, version);
      if (
        archived &&
        (await db.productComponent.count({
          where: {
            childProductId: id,
            parentProduct: { archivedAt: null },
          },
        }))
      ) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This product is used by an active recipe. Update that product first.',
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
      return (await serializeMany(db, userId, [product]))[0];
    });
  },

  async calculate(userId: string, id: string, input: QuantityInput) {
    const product = await nutritionProducts.get(userId, id);
    return {
      ...calculateNutrition(product, input),
      productVersion: product.version,
      recipeRevision: product.recipeRevision,
    };
  },
};
