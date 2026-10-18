import { TRPCError } from '@trpc/server';
import type { NutritionProduct } from './products';
import { referenceSnapshotSchema } from './diary-schema';
import { calculateNutrition } from './calculations';
import { unitLabels, type QuantityInput } from './types';

export function captureNutritionSnapshot(product: NutritionProduct) {
  return referenceSnapshotSchema.parse({
    schemaVersion: 1,
    calculationVersion: 'direct-v1',
    productId: product.id,
    productVersion: product.version,
    definition: product,
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
  const calculation = calculateNutrition(snapshot.definition, input);
  const unitLabel = input.servingId
    ? snapshot.definition.servings.find((serving) => serving.id === input.servingId)!.name
    : input.unit === 'SERVING'
      ? snapshot.definition.referenceLabel!
      : unitLabels[input.unit];
  return { ...calculation, unitLabel };
}
