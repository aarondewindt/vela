/** @jest-environment node */
import { calculateRecipe, type RecipeNode } from './recipes';
import { calculateNutrition } from './calculations';
import {
  captureNutritionSnapshot,
  calculateSnapshotNutrition,
  readNutritionSnapshot,
} from './snapshots';
import { productFixture } from './test-fixtures';
import { snapshotSources } from './attribution';
import type { NutritionProduct } from './products';

const ingredient: RecipeNode = {
  ...productFixture,
  calories: '100',
  protein: '10',
  carbohydrates: '20',
  fat: '5',
  fiber: '2',
  servings: [],
};
const recipe: RecipeNode = {
  ...ingredient,
  id: '00000000-0000-4000-8000-000000000010',
  name: 'Recipe',
  calculationMode: 'CALCULATED',
  referenceQuantity: '1',
  referenceUnit: 'SERVING',
  referenceLabel: 'portion',
  yieldQuantity: '4',
  yieldUnit: 'SERVING',
  components: [{ childProductId: ingredient.id, quantity: '200', unit: 'G' }],
};
const graph = (...nodes: RecipeNode[]) => new Map(nodes.map((node) => [node.id, node]));

it('normalizes a complete recipe to explicit yield and supports fractional portions', () => {
  const result = calculateRecipe(recipe.id, graph(recipe, ingredient));
  expect(result.calories).toBe('50');
  expect(result.protein).toBe('5');
  expect(calculateNutrition(result, { quantity: '1.5', unit: 'SERVING' }).nutrients.calories).toBe(
    '75'
  );
});
it('counts each component row and repeated ingredients across nested branches once per occurrence', () => {
  const parent: RecipeNode = {
    ...recipe,
    id: '00000000-0000-4000-8000-000000000011',
    yieldQuantity: '1',
    components: [
      { childProductId: recipe.id, quantity: '2', unit: 'SERVING' },
      { childProductId: ingredient.id, quantity: '100', unit: 'G' },
      { childProductId: ingredient.id, quantity: '50', unit: 'G' },
    ],
  };
  expect(calculateRecipe(parent.id, graph(parent, recipe, ingredient)).calories).toBe('250');
});
it('keeps DIRECT values authoritative even when component relationships exist', () => {
  const direct = { ...recipe, calculationMode: 'DIRECT' as const, calories: '999' };
  expect(calculateRecipe(direct.id, graph(direct, ingredient)).calories).toBe('999');
});
it('requires explicit cooked output weight and never derives it from raw ingredients', () => {
  const result = calculateRecipe(recipe.id, graph(recipe, ingredient));
  expect(() => calculateNutrition(result, { quantity: '100', unit: 'G' })).toThrow(
    'explicit physical serving size'
  );
  const weighted = {
    ...recipe,
    yieldQuantity: '800',
    yieldUnit: 'G' as const,
    servingSizeQuantity: '200',
    servingSizeUnit: 'G' as const,
  };
  const resolved = calculateRecipe(weighted.id, graph(weighted, ingredient));
  expect(resolved.calories).toBe('50');
  expect(calculateNutrition(resolved, { quantity: '100', unit: 'G' }).nutrients.calories).toBe(
    '25'
  );
});
it('rejects missing density, missing children, archived children, invalid quantities and missing yield', () => {
  expect(() => calculateRecipe(recipe.id, graph(recipe))).toThrow('missing');
  expect(() =>
    calculateRecipe(recipe.id, graph(recipe, { ...ingredient, archivedAt: new Date() }))
  ).toThrow('Restore');
  expect(() =>
    calculateRecipe(recipe.id, graph({ ...recipe, yieldQuantity: null }, ingredient))
  ).toThrow('yield');
  expect(() =>
    calculateRecipe(
      recipe.id,
      graph(
        { ...recipe, components: [{ childProductId: ingredient.id, quantity: '0', unit: 'G' }] },
        ingredient
      )
    )
  ).toThrow();
  expect(() =>
    calculateRecipe(
      recipe.id,
      graph(
        { ...recipe, components: [{ childProductId: ingredient.id, quantity: '10', unit: 'ML' }] },
        ingredient
      )
    )
  ).toThrow('density');
});
it('detects direct and indirect cycles including DIRECT products with components', () => {
  expect(() =>
    calculateRecipe(
      recipe.id,
      graph({
        ...recipe,
        components: [{ childProductId: recipe.id, quantity: '1', unit: 'SERVING' }],
      })
    )
  ).toThrow('circular');
  const cyclic = {
    ...ingredient,
    components: [{ childProductId: recipe.id, quantity: '1', unit: 'SERVING' as const }],
  };
  expect(() => calculateRecipe(recipe.id, graph(recipe, cyclic))).toThrow('circular');
});
it('bounds recursion depth and repeated branching without global deduplication', () => {
  const nodes: RecipeNode[] = [ingredient];
  for (let i = 0; i < 13; i++) {
    nodes.push({
      ...recipe,
      id: `level-${i}`,
      components: [
        { childProductId: nodes.at(-1)!.id, quantity: '1', unit: i === 0 ? 'G' : 'SERVING' },
      ],
    });
  }
  expect(() => calculateRecipe(nodes.at(-1)!.id, graph(...nodes))).toThrow('too complex');
  const branching = [ingredient];
  for (let i = 0; i < 3; i++) {
    branching.push({
      ...recipe,
      id: `branch-${i}`,
      components: Array.from({ length: 10 }, () => ({
        childProductId: branching.at(-1)!.id,
        quantity: '1',
        unit: i === 0 ? 'G' : 'SERVING',
      })),
    });
  }
  expect(() => calculateRecipe(branching.at(-1)!.id, graph(...branching))).toThrow('too complex');
});
it('retains decimal precision, incomplete fiber and ingredient estimation flags', () => {
  const estimated = {
    ...ingredient,
    fiber: null,
    servings: [
      {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'spoon',
        aliases: [],
        quantity: '1',
        canonicalUnit: 'G' as const,
        isDefault: true,
        isEstimated: true,
      },
    ],
  };
  const divided = {
    ...recipe,
    yieldQuantity: '3',
    components: [
      {
        childProductId: ingredient.id,
        quantity: '1',
        unit: 'SERVING' as const,
        servingId: estimated.servings[0].id,
      },
    ],
  };
  const result = calculateRecipe(recipe.id, graph(divided, estimated));
  expect(result.calories).toBe('0.33333333');
  expect(result.fiber).toBeNull();
  expect(calculateNutrition(result, { quantity: '1', unit: 'SERVING' }).estimated).toBe(true);
});
it('captures recipes as immutable v2 snapshots while continuing to read direct v1 history', () => {
  const nodes = graph(recipe, {
    ...ingredient,
    source: {
      type: 'DATASET',
      name: 'NEVO',
      recordId: 'fixture',
      version: 'NEVO-Online 2025 9.0',
      importedAt: null,
    },
  });
  const product: NutritionProduct = {
    ...productFixture,
    ...recipe,
    ...calculateRecipe(recipe.id, nodes),
    components: recipe.components!,
    yieldQuantity: recipe.yieldQuantity!,
    yieldUnit: recipe.yieldUnit!,
    recipeRevision: 'a'.repeat(64),
    composition: [...nodes.values()],
  };
  const snapshot = captureNutritionSnapshot(product);
  expect(snapshot.schemaVersion).toBe(2);
  expect(snapshotSources(snapshot).some((source) => source.name === 'NEVO')).toBe(true);
  nodes.set(ingredient.id, { ...ingredient, calories: '500' });
  expect(
    calculateSnapshotNutrition(snapshot, { quantity: '2', unit: 'SERVING' }).nutrients.calories
  ).toBe('100');
  expect(readNutritionSnapshot(captureNutritionSnapshot(productFixture)).schemaVersion).toBe(1);
  expect(() => readNutritionSnapshot({ ...snapshot, calculationVersion: 'unknown' })).toThrow(
    'could not be read'
  );
});
