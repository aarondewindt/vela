import { TRPCError } from '@trpc/server';
import type { NutritionProduct } from './products';
import { referenceSnapshotSchema } from './diary-schema';
import { calculateNutrition } from './calculations';
import { unitLabels, type QuantityInput } from './types';

export function captureNutritionSnapshot(product: NutritionProduct) {
  return referenceSnapshotSchema.parse({
    schemaVersion: product.calculationMode === 'CALCULATED' ? 2 : 1,
    calculationVersion: product.calculationMode === 'CALCULATED' ? 'recipe-v1' : 'direct-v1',
    productId: product.id,
    productVersion: product.version,
    definition: { ...product, calculationMode: 'DIRECT', components: [] },
    nutritionIsEstimated: product.nutritionIsEstimated ?? false,
    ...(product.calculationMode === 'CALCULATED'
      ? {
          recipeRevision: product.recipeRevision,
          composition: product.composition?.map((node) => ({
            id: node.id,
            name: node.name,
            version: node.version,
            calculationMode: node.calculationMode,
            source: node.source,
            definition: {
              ...node,
              verificationStatus: node.verificationStatus ?? 'UNVERIFIED',
              aliases: [],
              brand: null,
              description: null,
            },
          })),
        }
      : {}),
    source: {
      type: product.sourceType,
      name: product.sourceName,
      recordId: product.sourceRecordId,
      version: product.sourceVersion,
      importedAt: product.importedAt?.toISOString() ?? null,
    },
  });
}

export function readNutritionSnapshot(value: unknown) {
  const parsed = referenceSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'This entry’s saved nutrition reference could not be read.',
    });
  }
  return parsed.data;
}

export function calculateSnapshotNutrition(value: unknown, input: QuantityInput) {
  const snapshot = readNutritionSnapshot(value);
  const calculation = calculateNutrition(
    { ...snapshot.definition, nutritionIsEstimated: snapshot.nutritionIsEstimated },
    input
  );
  const unitLabel = input.servingId
    ? snapshot.definition.servings.find((serving) => serving.id === input.servingId)!.name
    : input.unit === 'SERVING'
      ? snapshot.definition.referenceLabel!
      : unitLabels[input.unit];
  return { ...calculation, unitLabel };
}
