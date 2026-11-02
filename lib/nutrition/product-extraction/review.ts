import type { ProductInput } from '../schema';
import type { ProductSuggestion } from './schema';

export type ReviewRow = { id: string; label: string; patch: Partial<ProductInput> };
const nutrients = ['calories', 'protein', 'carbohydrates', 'fat', 'fiber'] as const;
export function suggestionRows(suggestion: ProductSuggestion, current: ProductInput): ReviewRow[] {
  const patch = suggestion.product;
  const rows: ReviewRow[] = [];
  for (const key of ['name', 'brand', 'description', 'aliases', 'verificationStatus'] as const) {
    if (patch[key] !== undefined) {
      rows.push({ id: key, label: key, patch: { [key]: patch[key] } });
    }
  }
  if (patch.referenceUnit && patch.referenceQuantity) {
    const basisChanged =
      current.referenceUnit !== patch.referenceUnit ||
      current.referenceQuantity !== patch.referenceQuantity ||
      current.calculationMode !== 'DIRECT';
    const nutrition: Partial<ProductInput> = {
      referenceUnit: patch.referenceUnit,
      referenceQuantity: patch.referenceQuantity,
      calculationMode: 'DIRECT',
    };
    if (basisChanged) {
      Object.assign(nutrition, {
        referenceLabel: null,
        servingSizeQuantity: null,
        servingSizeUnit: null,
        servingSizeIsEstimated: false,
        ...Object.fromEntries(nutrients.map((key) => [key, key === 'fiber' ? null : ''])),
      });
    }
    for (const key of nutrients) {
      if (patch[key] !== undefined) {
        Object.assign(nutrition, { [key]: patch[key] });
      }
    }
    rows.push({
      id: 'nutrition',
      label: 'Nutrition and reference (kcal; nutrients in g)',
      patch: nutrition,
    });
  }
  // A serving list is one explicit review action; preserve unrelated named servings.
  if (patch.servings?.length) {
    const names = new Set(patch.servings.map((s) => s.name.trim().toLowerCase()));
    rows.push({
      id: 'servings',
      label: 'Package servings',
      patch: {
        servings: [
          ...current.servings.filter((s) => !names.has(s.name.trim().toLowerCase())),
          ...patch.servings,
        ],
      },
    });
  }
  return rows.filter((row) =>
    Object.entries(row.patch).some(
      ([key, value]) => JSON.stringify(current[key as keyof ProductInput]) !== JSON.stringify(value)
    )
  );
}
export function rowConflicts(row: ReviewRow, touched: ReadonlySet<keyof ProductInput>) {
  return Object.keys(row.patch).some((key) => touched.has(key as keyof ProductInput));
}
export function formatReviewValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return 'Missing';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (Array.isArray(value)) {
    return value.length
      ? value
          .map((item) =>
            typeof item === 'string'
              ? item
              : `${item.name}: ${item.quantity} ${item.canonicalUnit?.toLowerCase()}`
          )
          .join('; ')
      : 'None';
  }
  return String(value);
}
