import { defaultGoalOptions, evaluateGoal, type GoalOptions } from '@/lib/goals/semantics';
import { Decimal } from '@prisma/client/runtime/client';
import { positiveDecimalSchema, quantityInputSchema } from './schema';
import {
  goalKeys,
  type Nutrients,
  type NutritionDefinition,
  type QuantityInput,
  type ReferenceUnit,
  type GoalKey,
} from './types';

// Isolate nutrition arithmetic from any global Decimal settings in other consumers.
const NutritionDecimal = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
const maxStored = new NutritionDecimal('999999999999.99999999');

export class NutritionCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NutritionCalculationError';
  }
}

export function sumNutrition(entries: Nutrients[]) {
  const sum = (key: keyof Nutrients) =>
    entries
      .reduce((total, entry) => total.plus(entry[key] ?? '0'), new NutritionDecimal(0))
      .toFixed();
  const fiberIncomplete = entries.some((entry) => entry.fiber === null);
  return {
    calories: sum('calories'),
    protein: sum('protein'),
    carbohydrates: sum('carbohydrates'),
    fat: sum('fat'),
    fiber: fiberIncomplete ? null : sum('fiber'),
    knownFiber: sum('fiber'),
    fiberIncomplete,
  };
}

export function nutritionGoalProgress(
  totals: Nutrients,
  goals: Record<Exclude<GoalKey, 'fiber'>, string | null> & { fiber?: string | null } & {
    semantics?: Partial<Record<GoalKey, GoalOptions>>;
  }
) {
  return Object.fromEntries(
    goalKeys.map((key) => {
      const target = goals[key] ?? null;
      const consumed = totals[key] == null ? null : new NutritionDecimal(totals[key]);
      const options =
        goals.semantics?.[key] ??
        (key === 'protein' || key === 'fiber' ? { kind: 'minimum' as const } : defaultGoalOptions);
      const evaluation = evaluateGoal(totals[key], target, options);
      return [
        key,
        {
          consumed: totals[key],
          options,
          evaluation,
          goal: target,
          // Scalar distance/ratio remain compatible; evaluation owns goal success.
          remaining:
            target === null || consumed === null
              ? null
              : NutritionDecimal.max(new NutritionDecimal(target).minus(consumed), 0).toFixed(),
          exceeded: evaluation.status === 'above',
          percent:
            target === null || consumed === null
              ? null
              : NutritionDecimal.min(consumed.dividedBy(target).times(100), 100)
                  .toDecimalPlaces(1)
                  .toNumber(),
        },
      ];
    })
  ) as Record<
    GoalKey,
    {
      consumed: string | null;
      options: GoalOptions;
      evaluation: ReturnType<typeof evaluateGoal>;
      goal: string | null;
      remaining: string | null;
      exceeded: boolean;
      percent: number | null;
    }
  >;
}

export function storedNutritionDecimal(value: Decimal): string {
  const rounded = value.toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
  if (!rounded.isFinite() || rounded.isNegative() || rounded.greaterThan(maxStored)) {
    throw new NutritionCalculationError('The calculated amount exceeds the supported range.');
  }
  return rounded.toFixed();
}

export function calculateNutrition(product: NutritionDefinition, rawInput: QuantityInput) {
  const input = quantityInputSchema.parse(rawInput);
  const reference = new NutritionDecimal(positiveDecimalSchema.parse(product.referenceQuantity));
  let amount = new NutritionDecimal(input.quantity);
  let unit: ReferenceUnit;
  let estimated = product.nutritionIsEstimated ?? false;
  if (input.servingId) {
    const serving = product.servings.find((entry) => entry.id === input.servingId);
    if (!serving) {
      throw new NutritionCalculationError('Choose a serving defined for this product.');
    }
    amount = amount.times(positiveDecimalSchema.parse(serving.quantity));
    unit = serving.canonicalUnit;
    estimated ||= serving.isEstimated;
  } else {
    unit = input.unit === 'KG' ? 'G' : input.unit === 'L' ? 'ML' : input.unit;
    if (input.unit === 'KG' || input.unit === 'L') {
      amount = amount.times(1000);
    }
  }
  const physical = (value: Decimal, from: 'G' | 'ML', to: 'G' | 'ML') => {
    if (from === to) {
      return value;
    }
    if (!product.densityGramsPerMl) {
      throw new NutritionCalculationError(
        'This conversion needs a product-specific density (g per ml).'
      );
    }
    const density = positiveDecimalSchema.parse(product.densityGramsPerMl);
    estimated ||= product.densityIsEstimated;
    return from === 'ML' ? value.times(density) : value.dividedBy(density);
  };
  if (unit !== product.referenceUnit) {
    if (unit === 'SERVING' || product.referenceUnit === 'SERVING') {
      if (!product.servingSizeQuantity || !product.servingSizeUnit) {
        throw new NutritionCalculationError(
          'This conversion needs an explicit physical serving size.'
        );
      }
      const size = positiveDecimalSchema.parse(product.servingSizeQuantity);
      estimated ||= product.servingSizeIsEstimated;
      if (unit === 'SERVING') {
        if (product.referenceUnit === 'SERVING') {
          throw new NutritionCalculationError('Invalid serving conversion.');
        }
        amount = physical(amount.times(size), product.servingSizeUnit, product.referenceUnit);
      } else {
        amount = physical(amount, unit, product.servingSizeUnit).dividedBy(size);
      }
    } else {
      amount = physical(amount, unit, product.referenceUnit);
    }
  }
  const factor = amount.dividedBy(reference);
  const scale = (value: string) =>
    storedNutritionDecimal(new NutritionDecimal(value).times(factor));
  // Validate before serialization so a tiny positive quantity cannot disappear in NUMERIC storage.
  const resolvedQuantity = storedNutritionDecimal(amount);
  if (resolvedQuantity === '0') {
    throw new NutritionCalculationError('The resolved quantity is too small to store accurately.');
  }
  return {
    resolvedQuantity,
    referenceUnit: product.referenceUnit,
    estimated,
    nutrients: {
      calories: scale(product.calories),
      protein: scale(product.protein),
      carbohydrates: scale(product.carbohydrates),
      fat: scale(product.fat),
      fiber: product.fiber === null ? null : scale(product.fiber),
    } satisfies Nutrients,
  };
}
