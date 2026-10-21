export const referenceUnits = ['G', 'ML', 'SERVING'] as const;
export const quantityUnits = ['G', 'KG', 'ML', 'L', 'SERVING'] as const;
export const sourceTypes = ['MANUAL', 'DATASET', 'AI_ESTIMATE', 'EXTERNAL_API'] as const;
export const verificationStatuses = ['UNVERIFIED', 'VERIFIED', 'ESTIMATED'] as const;
export const nutrientKeys = ['calories', 'protein', 'carbohydrates', 'fat', 'fiber'] as const;
export const mealCategories = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS'] as const;
export type MealCategory = (typeof mealCategories)[number];
export const mealLabels: Record<MealCategory, string> = {
  BREAKFAST: 'Breakfast',
  LUNCH: 'Lunch',
  DINNER: 'Dinner',
  SNACKS: 'Snacks',
};
export const goalKeys = ['calories', 'protein', 'carbohydrates', 'fat', 'fiber'] as const;
export type GoalKey = (typeof goalKeys)[number];
export type ReferenceUnit = (typeof referenceUnits)[number];
export type QuantityUnit = (typeof quantityUnits)[number];
export type NutrientKey = (typeof nutrientKeys)[number];

export const unitLabels: Record<QuantityUnit, string> = {
  G: 'g',
  KG: 'kg',
  ML: 'ml',
  L: 'l',
  SERVING: 'serving',
};

export type Nutrients = {
  calories: string;
  protein: string;
  carbohydrates: string;
  fat: string;
  fiber: string | null;
};

export type ServingDefinition = {
  id?: string;
  name: string;
  aliases: string[];
  quantity: string;
  canonicalUnit: ReferenceUnit;
  isDefault: boolean;
  isEstimated: boolean;
};

export type NutritionDefinition = Nutrients & {
  calculationMode: 'DIRECT' | 'CALCULATED';
  nutritionIsEstimated?: boolean;
  referenceQuantity: string;
  referenceUnit: ReferenceUnit;
  referenceLabel: string | null;
  servingSizeQuantity: string | null;
  servingSizeUnit: 'G' | 'ML' | null;
  servingSizeIsEstimated: boolean;
  densityGramsPerMl: string | null;
  densityIsEstimated: boolean;
  servings: ServingDefinition[];
};

export type QuantityInput = { quantity: string; unit: QuantityUnit; servingId?: string };

export type ProductComponentInput = QuantityInput & { childProductId: string };
