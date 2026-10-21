/** @jest-environment node */
import {
  calculateNutrition,
  nutritionGoalProgress,
  NutritionCalculationError,
} from './calculations';
import type { NutritionDefinition } from './types';

export const peanutButter: NutritionDefinition = {
  calculationMode: 'DIRECT',
  referenceQuantity: '100',
  referenceUnit: 'G',
  referenceLabel: null,
  calories: '588',
  protein: '25',
  carbohydrates: '20',
  fat: '50',
  fiber: null,
  servingSizeQuantity: null,
  servingSizeUnit: null,
  servingSizeIsEstimated: false,
  densityGramsPerMl: null,
  densityIsEstimated: false,
  servings: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'tablespoon',
      aliases: ['tbsp'],
      quantity: '15',
      canonicalUnit: 'G',
      isDefault: true,
      isEstimated: true,
    },
  ],
};

it('scales per-100-g nutrition and preserves unknown fiber', () => {
  expect(calculateNutrition(peanutButter, { quantity: '30', unit: 'G' })).toEqual({
    resolvedQuantity: '30',
    referenceUnit: 'G',
    estimated: false,
    nutrients: { calories: '176.4', protein: '7.5', carbohydrates: '6', fat: '15', fiber: null },
  });
});
it('handles millilitres, kilograms, litres and fractional quantities', () => {
  const milk = { ...peanutButter, referenceUnit: 'ML' as const, calories: '45' };
  expect(calculateNutrition(milk, { quantity: '250', unit: 'ML' }).nutrients.calories).toBe(
    '112.5'
  );
  expect(calculateNutrition(milk, { quantity: '0.5', unit: 'L' }).nutrients.calories).toBe('225');
  expect(
    calculateNutrition(peanutButter, { quantity: '0.03', unit: 'KG' }).nutrients.calories
  ).toBe('176.4');
  const result = calculateNutrition(peanutButter, {
    quantity: '1.5',
    unit: 'SERVING',
    servingId: peanutButter.servings[0].id,
  });
  expect(result.nutrients.calories).toBe('132.3');
  expect(result.resolvedQuantity).toBe('22.5');
  expect(result.estimated).toBe(true);
});
it('supports named-serving nutrition without inventing a weight', () => {
  const bar = {
    ...peanutButter,
    referenceQuantity: '1',
    referenceUnit: 'SERVING' as const,
    referenceLabel: 'bar',
    calories: '210',
    servings: [],
  };
  expect(calculateNutrition(bar, { quantity: '0.5', unit: 'SERVING' }).nutrients.calories).toBe(
    '105'
  );
  expect(() => calculateNutrition(bar, { quantity: '60', unit: 'G' })).toThrow(
    'physical serving size'
  );
  const sizedBar = {
    ...bar,
    servingSizeQuantity: '60',
    servingSizeUnit: 'G' as const,
    servingSizeIsEstimated: true,
  };
  expect(calculateNutrition(sizedBar, { quantity: '120', unit: 'G' })).toMatchObject({
    estimated: true,
    nutrients: { calories: '420' },
  });
});
it('converts weight and volume only with an explicit density', () => {
  expect(() => calculateNutrition(peanutButter, { quantity: '30', unit: 'ML' })).toThrow('density');
  const oil = { ...peanutButter, calories: '900', densityGramsPerMl: '0.91' };
  expect(calculateNutrition(oil, { quantity: '100', unit: 'ML' }).nutrients.calories).toBe('819');
  const volume = {
    ...peanutButter,
    referenceUnit: 'ML' as const,
    densityGramsPerMl: '0.5',
    densityIsEstimated: true,
  };
  expect(calculateNutrition(volume, { quantity: '50', unit: 'G' })).toMatchObject({
    estimated: true,
    nutrients: { calories: '588' },
  });
});
it('combines density and physical serving size without a binary-float step', () => {
  const serving = {
    ...peanutButter,
    referenceQuantity: '1',
    referenceUnit: 'SERVING' as const,
    referenceLabel: 'bowl',
    servingSizeQuantity: '100',
    servingSizeUnit: 'G' as const,
    densityGramsPerMl: '0.5',
  };
  expect(calculateNutrition(serving, { quantity: '200', unit: 'ML' }).nutrients.calories).toBe(
    '588'
  );
  expect(
    calculateNutrition(
      { ...peanutButter, referenceQuantity: '1', calories: '0.1' },
      { quantity: '0.2', unit: 'G' }
    ).nutrients.calories
  ).toBe('0.02');
  expect(
    calculateNutrition(
      { ...peanutButter, referenceQuantity: '3', calories: '1' },
      { quantity: '1', unit: 'G' }
    ).nutrients.calories
  ).toBe('0.33333333');
});
it.each(['0', '-1', 'NaN', 'Infinity', '1e3', '0.000000001', '1000000000000'])(
  'rejects invalid quantity %s',
  (quantity) => {
    expect(() => calculateNutrition(peanutButter, { quantity, unit: 'G' })).toThrow();
  }
);
it('rejects unknown servings, a zero reference, overflow and underflow', () => {
  expect(() =>
    calculateNutrition(peanutButter, {
      quantity: '1',
      unit: 'SERVING',
      servingId: '00000000-0000-4000-8000-000000000099',
    })
  ).toThrow('defined for this product');
  expect(() =>
    calculateNutrition({ ...peanutButter, referenceQuantity: '0' }, { quantity: '1', unit: 'G' })
  ).toThrow();
  expect(() => calculateNutrition(peanutButter, { quantity: '999999999999', unit: 'KG' })).toThrow(
    NutritionCalculationError
  );
  expect(() =>
    calculateNutrition(
      { ...peanutButter, densityGramsPerMl: '0.00000001' },
      { quantity: '0.00000001', unit: 'ML' }
    )
  ).toThrow('too small');
});

it('keeps unknown fiber progress unknown and evaluates known fiber milestones', () => {
  const goals = {
    calories: null,
    protein: null,
    carbohydrates: null,
    fat: null,
    fiber: '25',
    semantics: { fiber: { kind: 'minimum' as const, preferredTarget: '30', excellent: '40' } },
  };
  const totals = { calories: '0', protein: '0', carbohydrates: '0', fat: '0', fiber: null };
  expect(nutritionGoalProgress(totals, goals).fiber).toMatchObject({
    consumed: null,
    percent: null,
    remaining: null,
    evaluation: { status: 'unknown' },
  });
  expect(nutritionGoalProgress({ ...totals, fiber: '40' }, goals).fiber.evaluation).toMatchObject({
    status: 'excellent',
    color: 'cyan',
    satisfied: true,
  });
});
