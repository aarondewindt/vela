import 'server-only';
import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '../../generated/prisma/client';
import { NutritionCalculationError } from './calculations';
import { calculateRecipe, MAX_RECIPE_DEPTH, MAX_RECIPE_NODES, type RecipeNode } from './recipes';
import type { ProductComponentInput } from './types';

export const productInclude = {
  servings: { orderBy: [{ isDefault: 'desc' }, { normalizedName: 'asc' }, { id: 'asc' }] },
  components: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ProductInclude;
export type ProductRecord = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

/** All catalog mutations and final snapshot captures take this lock before row locks. */
export async function lockProductGraph(db: Prisma.TransactionClient, userId: string) {
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`nutrition-products:${userId}`}, 0))::text`;
}

export async function validateComponentInputs(
  db: Prisma.TransactionClient,
  userId: string,
  components: ProductComponentInput[],
  parentId?: string
) {
  if (!components.length) {
    return;
  }
  if (components.some((entry) => entry.childProductId === parentId)) {
    throw new NutritionCalculationError('A recipe cannot contain itself.');
  }
  const ids = [...new Set(components.map((entry) => entry.childProductId))];
  const children = await db.product.findMany({
    where: { userId, id: { in: ids } },
    include: productInclude,
  });
  if (children.length !== ids.length) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Recipe ingredient not found.' });
  }
  for (const component of components) {
    const child = children.find((entry) => entry.id === component.childProductId)!;
    if (child.archivedAt) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose an active recipe ingredient.' });
    }
    if (
      component.servingId &&
      !child.servings.some((serving) => serving.id === component.servingId)
    ) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Choose a serving defined for this ingredient.',
      });
    }
  }
}

export function productDefinition(product: ProductRecord): RecipeNode {
  return {
    id: product.id,
    name: product.name,
    version: product.version,
    archivedAt: product.archivedAt,
    calculationMode: product.calculationMode,
    verificationStatus: product.verificationStatus,
    source: {
      type: product.sourceType,
      name: product.sourceName,
      recordId: product.sourceRecordId,
      version: product.sourceVersion,
      importedAt: product.importedAt?.toISOString() ?? null,
    },
    referenceQuantity: product.referenceQuantity.toFixed(),
    referenceUnit: product.referenceUnit,
    referenceLabel: product.referenceLabel,
    calories: product.calories?.toFixed() ?? '0',
    protein: product.protein?.toFixed() ?? '0',
    carbohydrates: product.carbohydrates?.toFixed() ?? '0',
    fat: product.fat?.toFixed() ?? '0',
    fiber: product.fiber?.toFixed() ?? null,
    servingSizeQuantity: product.servingSizeQuantity?.toFixed() ?? null,
    servingSizeUnit:
      product.servingSizeUnit === 'G' || product.servingSizeUnit === 'ML'
        ? product.servingSizeUnit
        : null,
    servingSizeIsEstimated: product.servingSizeIsEstimated,
    densityGramsPerMl: product.densityGramsPerMl?.toFixed() ?? null,
    densityIsEstimated: product.densityIsEstimated,
    yieldQuantity: product.yieldQuantity?.toFixed() ?? null,
    yieldUnit: product.yieldUnit ?? null,
    components: (product.components ?? []).map((entry) => ({
      childProductId: entry.childProductId,
      quantity: entry.quantity.toFixed(),
      unit: entry.unit,
      ...(entry.servingId ? { servingId: entry.servingId } : {}),
    })),
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

/** Batch each graph level; never scan the full imported food catalog. */
export async function loadProductGraph(
  db: Prisma.TransactionClient,
  userId: string,
  roots: ProductRecord[]
) {
  const records = new Map(roots.map((product) => [product.id, product]));
  let frontier = roots;
  for (let depth = 0; frontier.length; depth++) {
    const missing = [
      ...new Set(
        frontier.flatMap((product) =>
          (product.components ?? [])
            .map((entry) => entry.childProductId)
            .filter((id) => !records.has(id))
        )
      ),
    ];
    if (!missing.length) {
      break;
    }
    if (
      depth >= MAX_RECIPE_DEPTH ||
      records.size + missing.length > MAX_RECIPE_NODES * Math.max(roots.length, 1)
    ) {
      throw new NutritionCalculationError('This recipe graph is too complex.');
    }
    frontier = await db.product.findMany({
      where: { userId, id: { in: missing } },
      include: productInclude,
    });
    if (frontier.length !== missing.length) {
      throw new NutritionCalculationError('A recipe ingredient is missing or unavailable.');
    }
    frontier.forEach((record) => records.set(record.id, record));
  }
  return new Map([...records].map(([id, product]) => [id, productDefinition(product)]));
}

export function resolvedProduct(product: ProductRecord, graph: Map<string, RecipeNode>) {
  const root = graph.get(product.id)!;
  const definition =
    root.components?.length || root.calculationMode === 'CALCULATED'
      ? calculateRecipe(product.id, graph)
      : root;
  const nodes = new Map<string, RecipeNode>();
  const collect = (id: string) => {
    if (nodes.has(id)) {
      return;
    }
    const node = graph.get(id)!;
    nodes.set(id, node);
    node.components?.forEach((entry) => collect(entry.childProductId));
  };
  collect(product.id);
  const composition = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    ...definition,
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
    yieldQuantity: root.yieldQuantity ?? null,
    yieldUnit: root.yieldUnit ?? null,
    components: root.components ?? [],
    ...(root.calculationMode === 'CALCULATED'
      ? {
          recipeRevision: createHash('sha256').update(JSON.stringify(composition)).digest('hex'),
          composition,
        }
      : {}),
  };
}

/** Reject ingredient edits/imports that would invalidate an existing recipe. */
export async function validateProductDependents(
  db: Prisma.TransactionClient,
  userId: string,
  changedIds: string[]
) {
  if (!changedIds.length) {
    return;
  }
  let frontier = changedIds;
  const parents = new Map<string, ProductRecord>();
  for (let depth = 0; frontier.length; depth++) {
    const found = await db.product.findMany({
      where: { userId, components: { some: { childProductId: { in: frontier } } } },
      include: productInclude,
    });
    const next = found.filter((product) => !parents.has(product.id));
    next.forEach((product) => parents.set(product.id, product));
    if (depth >= MAX_RECIPE_DEPTH || parents.size > MAX_RECIPE_NODES) {
      throw new NutritionCalculationError('Too many dependent recipes to update safely.');
    }
    frontier = next.map((product) => product.id);
  }
  const roots = [...parents.values()];
  const graph = await loadProductGraph(db, userId, roots);
  roots.forEach((product) => calculateRecipe(product.id, graph));
}
