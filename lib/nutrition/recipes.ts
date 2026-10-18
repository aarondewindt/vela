import { Decimal } from '@prisma/client/runtime/client';
import {
  calculateNutrition,
  NutritionCalculationError,
  storedNutritionDecimal,
  sumNutrition,
} from './calculations';
import type { NutritionDefinition, ProductComponentInput, ReferenceUnit } from './types';

const RecipeDecimal = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
export const MAX_RECIPE_DEPTH = 12;
export const MAX_RECIPE_NODES = 250;
export type RecipeNode = NutritionDefinition & {
  id: string;
  name: string;
  version: number;
  archivedAt: Date | null;
  yieldQuantity?: string | null;
  yieldUnit?: ReferenceUnit | null;
  components?: ProductComponentInput[];
  verificationStatus?: 'UNVERIFIED' | 'VERIFIED' | 'ESTIMATED';
  source?: {
    type: 'MANUAL' | 'DATASET' | 'AI_ESTIMATE' | 'EXTERNAL_API';
    name: string | null;
    recordId: string | null;
    version: string | null;
    importedAt: string | null;
  };
};

/** Ancestor-path detection permits repeated ingredients in independent branches. */
export function calculateRecipe(rootId: string, products: Map<string, RecipeNode>) {
  let visited = 0;
  const resolve = (id: string, ancestors: Set<string>): NutritionDefinition => {
    if (ancestors.has(id)) {
      throw new NutritionCalculationError('Recipes cannot contain a circular product reference.');
    }
    if (ancestors.size >= MAX_RECIPE_DEPTH || ++visited > MAX_RECIPE_NODES) {
      throw new NutritionCalculationError(
        'This recipe is too complex (12 levels or 250 ingredient visits).'
      );
    }
    const product = products.get(id);
    if (!product) {
      throw new NutritionCalculationError('A recipe ingredient is missing or unavailable.');
    }
    if (ancestors.size && product.archivedAt && !products.get(rootId)?.archivedAt) {
      throw new NutritionCalculationError(
        `Restore the ingredient “${product.name}” before using this recipe.`
      );
    }
    const path = new Set(ancestors).add(id);
    // Validate all references, even in DIRECT mode, without adding their nutrients.
    const contributions = (product.components ?? []).map((component) =>
      calculateNutrition(resolve(component.childProductId, path), component)
    );
    if (product.calculationMode === 'DIRECT') {
      return product;
    }
    if (!contributions.length || !product.yieldQuantity || !product.yieldUnit) {
      throw new NutritionCalculationError(
        'Calculated recipes need ingredients and an explicit prepared yield.'
      );
    }
    // Convert the full prepared output to the parent's reference dimension. Never infer
    // cooked yield from ingredient weights. Unit conversion uses the shared calculator.
    const output = calculateNutrition(
      { ...product, calories: '0', protein: '0', carbohydrates: '0', fat: '0', fiber: '0' },
      {
        quantity: product.yieldQuantity,
        unit: product.yieldUnit,
      }
    );
    const totals = sumNutrition(contributions.map((entry) => entry.nutrients));
    const factor = new RecipeDecimal(product.referenceQuantity).dividedBy(output.resolvedQuantity);
    const scale = (value: string) => storedNutritionDecimal(new RecipeDecimal(value).times(factor));
    return {
      ...product,
      calories: scale(totals.calories),
      protein: scale(totals.protein),
      carbohydrates: scale(totals.carbohydrates),
      fat: scale(totals.fat),
      fiber: totals.fiber === null ? null : scale(totals.fiber),
      nutritionIsEstimated: output.estimated || contributions.some((entry) => entry.estimated),
    };
  };
  return resolve(rootId, new Set());
}
