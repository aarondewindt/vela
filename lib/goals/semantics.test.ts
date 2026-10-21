/** @jest-environment node */
import {
  defaultGoalOptions,
  evaluateGoal,
  goalOptionsSchema,
  readGoalOptions,
  validateGoalBounds,
  type GoalOptions,
} from './semantics';
import { goalsInputSchema } from '@/lib/nutrition/diary-schema';
import { goalSchema } from '@/lib/health/schema';

it.each<[GoalOptions, string, string, string, boolean]>([
  [{ kind: 'minimum' }, '100', '99.99999999', 'below', false],
  [{ kind: 'minimum' }, '100', '100', 'reached', true],
  [{ kind: 'minimum' }, '100', '200', 'reached', true],
  [{ kind: 'maximum' }, '0', '0', 'within', true],
  [{ kind: 'minimum' }, '0', '0', 'reached', true],
  [{ kind: 'maximum' }, '100', '0', 'within', true],
  [{ kind: 'maximum' }, '100', '100', 'within', true],
  [{ kind: 'maximum' }, '100', '100.00000001', 'above', false],
  [{ kind: 'target' }, '0', '0', 'within', true],
  [{ kind: 'target' }, '0', '-0.1', 'below', false],
  [{ kind: 'target' }, '-300', '-300', 'within', true],
  [{ kind: 'target', tolerance: '50' }, '-300', '-350', 'within', true],
  [{ kind: 'target', tolerance: '50' }, '-300', '-250', 'within', true],
  [{ kind: 'target', tolerance: '50' }, '-300', '-249.99', 'above', false],
  [{ kind: 'range', upperBound: '-200' }, '-400', '-400', 'within', true],
  [{ kind: 'range', upperBound: '-200' }, '-400', '-200', 'within', true],
  [{ kind: 'range', upperBound: '-200' }, '-400', '-400.01', 'below', false],
  [{ kind: 'range', upperBound: '-200' }, '-400', '-199.99', 'above', false],
  [{ kind: 'range', upperBound: '0' }, '0', '0', 'within', true],
])('evaluates %j target %s at %s inclusively', (options, target, value, status, satisfied) => {
  expect(evaluateGoal(value, target, options)).toMatchObject({ status, satisfied });
});
it('distinguishes unset goals and unknown observations without dividing signed or zero targets', () => {
  expect(evaluateGoal(null, '0')).toMatchObject({
    status: 'unknown',
    satisfied: null,
    difference: null,
  });
  expect(evaluateGoal('0', null)).toMatchObject({ status: 'unset', satisfied: null });
  expect(evaluateGoal('0.3', '0.1')).toMatchObject({ difference: '0.2' });
  expect(readGoalOptions({})).toEqual(defaultGoalOptions);
  expect(readGoalOptions(null)).toEqual(defaultGoalOptions);
  expect(validateGoalBounds('2', { kind: 'range', upperBound: '1' })).toBe(false);
});
it.each([
  { kind: 'target', tolerance: '-1' },
  { kind: 'range', upperBound: 'NaN' },
  { kind: 'range' },
  { kind: 'dynamic' },
  { kind: 'minimum', tolerance: '1' },
])('rejects invalid goal options %j', (options) => {
  expect(goalOptionsSchema.safeParse(options).success).toBe(false);
});
it('validates bounds at each application boundary while retaining legacy input compatibility', () => {
  const nutrition = { version: 0, calories: '2000', protein: null, carbohydrates: null, fat: null };
  expect(goalsInputSchema.safeParse(nutrition).success).toBe(true);
  expect(
    goalsInputSchema.safeParse({
      ...nutrition,
      semantics: { calories: { kind: 'range', upperBound: '1900' } },
    }).success
  ).toBe(false);
  expect(
    goalsInputSchema.safeParse({
      ...nutrition,
      semantics: { calories: { kind: 'range', upperBound: '2200' } },
    }).success
  ).toBe(true);
  expect(
    goalSchema.safeParse({
      version: 0,
      calorieBalance: -300,
      semantics: { kind: 'range', upperBound: '-400' },
    }).success
  ).toBe(false);
  expect(
    goalSchema.safeParse({
      version: 0,
      calorieBalance: -300,
      semantics: { kind: 'range', upperBound: '-200' },
    }).success
  ).toBe(true);
  expect(
    goalSchema.safeParse({
      version: 0,
      calorieBalance: 0,
      semantics: { kind: 'range', upperBound: '10001' },
    }).success
  ).toBe(false);
});

it.each([
  ['99.99999999', 'below', 'red'],
  ['100', 'minimum', 'orange'],
  ['149.99999999', 'minimum', 'orange'],
  ['150', 'reached', 'green'],
  ['179.99999999', 'reached', 'green'],
  ['180', 'excellent', 'cyan'],
  ['1000', 'excellent', 'cyan'],
])('evaluates minimum milestones at %s', (value, status, color) => {
  expect(
    evaluateGoal(value, '100', { kind: 'minimum', preferredTarget: '150', excellent: '180' })
  ).toMatchObject({ status, color, satisfied: status !== 'below', upperBound: null });
});

it('keeps a preferred target inside inclusive bounds, including signed balance ranges', () => {
  const options = { kind: 'range' as const, upperBound: '-200', preferredTarget: '-300' };
  expect(validateGoalBounds('-400', options)).toBe(true);
  expect(evaluateGoal('-350', '-400', options)).toMatchObject({
    status: 'within',
    difference: '-50',
  });
  expect(evaluateGoal('-200', '-400', options).satisfied).toBe(true);
  expect(validateGoalBounds('-250', options)).toBe(false);
  expect(validateGoalBounds('-400', { ...options, preferredTarget: '-100' })).toBe(false);
});

it('validates ordered milestones at Nutrition and Health boundaries', () => {
  const input = {
    version: 0,
    calories: null,
    protein: '100',
    fiber: '25',
    carbohydrates: null,
    fat: '50',
  };
  for (const options of [
    { kind: 'minimum', preferredTarget: '99', excellent: '200' },
    { kind: 'minimum', preferredTarget: '150', excellent: '149' },
    { kind: 'minimum', excellent: '200' },
  ]) {
    expect(goalsInputSchema.safeParse({ ...input, semantics: { protein: options } }).success).toBe(
      false
    );
  }
  expect(
    goalsInputSchema.safeParse({
      ...input,
      semantics: {
        protein: { kind: 'minimum', preferredTarget: '150', excellent: '180' },
        fiber: { kind: 'minimum', preferredTarget: '30', excellent: '40' },
        fat: { kind: 'range', preferredTarget: '60', upperBound: '70' },
      },
    }).success
  ).toBe(true);
  expect(
    goalSchema.safeParse({
      version: 0,
      calorieBalance: -400,
      semantics: { kind: 'range', upperBound: '-200', preferredTarget: '-100' },
    }).success
  ).toBe(false);
  expect(
    goalSchema.safeParse({
      version: 0,
      calorieBalance: -400,
      semantics: { kind: 'range', upperBound: '-200', preferredTarget: '-300' },
    }).success
  ).toBe(true);
});
