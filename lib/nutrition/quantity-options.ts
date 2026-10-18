import {
  unitLabels,
  type NutritionDefinition,
  type QuantityInput,
  type QuantityUnit,
} from './types';

export function quantityOptions(definition: NutritionDefinition) {
  return [
    ...(['G', 'KG', 'ML', 'L'] as const).map((unit) => ({ value: unit, label: unitLabels[unit] })),
    ...(definition.referenceUnit === 'SERVING'
      ? [{ value: 'SERVING', label: definition.referenceLabel || 'serving' }]
      : []),
    ...definition.servings.map((serving) => ({
      value: `serving:${serving.id}`,
      label: `${serving.name}${serving.isEstimated ? ' (estimated)' : ''}`,
    })),
  ];
}

export function defaultQuantity(definition: NutritionDefinition) {
  const serving = definition.servings.find((entry) => entry.isDefault);
  return {
    quantity: serving ? '1' : definition.referenceQuantity,
    selection: serving ? `serving:${serving.id}` : definition.referenceUnit,
  };
}

export function quantitySelection(input: QuantityInput) {
  return input.servingId ? `serving:${input.servingId}` : input.unit;
}

export function selectedQuantity(quantity: string, selection: string): QuantityInput {
  return selection.startsWith('serving:')
    ? { quantity, unit: 'SERVING', servingId: selection.slice(8) }
    : { quantity, unit: selection as QuantityUnit };
}
