import { goalSchema, metricGoalsSchema } from './schema';

it('accepts explicit weight, body-fat and sleep targets with shared semantics', () => {
  expect(
    metricGoalsSchema.parse({
      WEIGHT: { target: 80, semantics: { kind: 'range', upperBound: '85' } },
      BODY_FAT: { target: 20, semantics: { kind: 'target', tolerance: '2' } },
      SLEEP: { target: 8, semantics: { kind: 'minimum' } },
    })
  ).toHaveProperty('SLEEP.target', 8);
  expect(goalSchema.parse({ version: 0, calorieBalance: null }).metricGoals).toBeUndefined();
  expect(
    metricGoalsSchema.parse({ WEIGHT: { target: null, semantics: { kind: 'target' } } }).WEIGHT
      ?.target
  ).toBeNull();
});
it.each([
  { WEIGHT: { target: 0, semantics: { kind: 'target' } } },
  { WEIGHT: { target: 80, semantics: { kind: 'range', upperBound: '79' } } },
  { BODY_FAT: { target: 101, semantics: { kind: 'maximum' } } },
  { SLEEP: { target: 23, semantics: { kind: 'target', tolerance: '2' } } },
  { SLEEP: { target: 8, semantics: { kind: 'minimum', preferredTarget: '25' } } },
  { LEAN_MASS: { target: 60, semantics: { kind: 'target' } } },
])('rejects invalid or deferred metric goals: %j', (goals) => {
  expect(metricGoalsSchema.safeParse(goals).success).toBe(false);
});
