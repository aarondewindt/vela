/** @jest-environment node */
import { nutritionGoalProgress, sumNutrition } from './calculations';

it('sums stored decimals without binary rounding and distinguishes missing fiber', () => {
  const totals = sumNutrition([
    { calories: '0.1', protein: '0.1', carbohydrates: '1', fat: '0', fiber: null },
    { calories: '0.2', protein: '0.2', carbohydrates: '2', fat: '0', fiber: '1.5' },
  ]);
  expect(totals).toEqual({
    calories: '0.3',
    protein: '0.3',
    carbohydrates: '3',
    fat: '0',
    fiber: null,
    knownFiber: '1.5',
    fiberIncomplete: true,
  });
  expect(sumNutrition([])).toEqual({
    calories: '0',
    protein: '0',
    carbohydrates: '0',
    fat: '0',
    fiber: '0',
    knownFiber: '0',
    fiberIncomplete: false,
  });
});
it('reports user-entered targets, exact remaining values and capped display progress', () => {
  const totals = { calories: '176.4', protein: '7.5', carbohydrates: '6', fat: '15', fiber: null };
  const progress = nutritionGoalProgress(totals, {
    calories: '200',
    protein: null,
    carbohydrates: '5',
    fat: '15',
  });
  expect(progress.calories).toEqual({
    consumed: '176.4',
    goal: '200',
    remaining: '23.6',
    percent: 88.2,
    exceeded: false,
  });
  expect(progress.protein).toMatchObject({
    goal: null,
    remaining: null,
    percent: null,
    exceeded: false,
  });
  expect(progress.carbohydrates).toMatchObject({ remaining: '0', percent: 100, exceeded: true });
  expect(progress.fat).toMatchObject({ remaining: '0', percent: 100, exceeded: false });
});
