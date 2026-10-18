import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { normalizeProductText } from './normalization';
import { captureNutritionSnapshot, calculateSnapshotNutrition } from './snapshots';
import { NutritionCalculationError, sumNutrition } from './calculations';
import type { NutritionProduct } from './products';
import type { ReferenceSnapshot } from './diary-schema';
import type { QuantityInput, MealCategory } from './types';
import {
  draftItemsSchema,
  draftInterpretationSchema,
  type DraftItem,
  type DraftInterpretation,
} from './draft-schema';

const standardUnits: Record<string, QuantityInput['unit']> = {
  g: 'G',
  gram: 'G',
  grams: 'G',
  kg: 'KG',
  kilogram: 'KG',
  kilograms: 'KG',
  ml: 'ML',
  milliliter: 'ML',
  milliliters: 'ML',
  millilitre: 'ML',
  millilitres: 'ML',
  l: 'L',
  liter: 'L',
  liters: 'L',
  litre: 'L',
  litres: 'L',
};
const singularUnits: Record<string, string> = {
  slices: 'slice',
  pieces: 'piece',
  tablespoons: 'tablespoon',
  teaspoons: 'teaspoon',
  portions: 'portion',
  servings: 'serving',
  cups: 'cup',
  bars: 'bar',
  bowls: 'bowl',
};

export function resolveDraftQuantity(
  snapshot: ReferenceSnapshot | null,
  quantity: string | null,
  rawUnit: string | null
): QuantityInput | null {
  if (!snapshot || !quantity || !rawUnit) {
    return null;
  }
  const unit = normalizeProductText(rawUnit);
  const standard = standardUnits[unit];
  if (standard) {
    return { quantity, unit: standard };
  }
  const definition = snapshot.definition;
  const servingUnit = singularUnits[unit] ?? unit;
  const matching = definition.servings.filter(
    (serving) =>
      unit === `serving:${serving.id}` ||
      [serving.name, ...serving.aliases].some((name) => {
        const normalized = normalizeProductText(name);
        return (singularUnits[normalized] ?? normalized) === servingUnit;
      })
  );
  if (matching.length === 1) {
    return { quantity, unit: 'SERVING', servingId: matching[0].id! };
  }
  if (matching.length > 1) {
    return null;
  }
  if (
    definition.referenceUnit === 'SERVING' &&
    [
      'serving',
      singularUnits[normalizeProductText(definition.referenceLabel ?? '')] ??
        normalizeProductText(definition.referenceLabel ?? ''),
    ].includes(servingUnit)
  ) {
    return { quantity, unit: 'SERVING' };
  }
  return null;
}

export function withDraftProduct(item: DraftItem, product: NutritionProduct | null): DraftItem {
  if (product?.archivedAt) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose an active food product.' });
  }
  const snapshot = product ? captureNutritionSnapshot(product) : null;
  return { ...item, snapshot, input: resolveDraftQuantity(snapshot, item.quantity, item.unit) };
}

export function newDraftItem(query: string): DraftItem {
  return {
    id: randomUUID(),
    query,
    quantity: null,
    unit: null,
    snapshot: null,
    input: null,
    candidates: [],
  };
}

export function previewDraftItems(value: unknown) {
  const items = draftItemsSchema.parse(value).map((item) => {
    let issue: string | null = !item.snapshot
      ? 'Choose a food product.'
      : !item.quantity
        ? 'Enter a quantity.'
        : !item.unit
          ? 'Choose a unit.'
          : !item.input
            ? 'This unit needs a configured serving conversion. Choose a supported unit.'
            : null;
    let calculation: ReturnType<typeof calculateSnapshotNutrition> | null = null;
    if (!issue && item.input) {
      try {
        calculation = calculateSnapshotNutrition(item.snapshot, item.input);
      } catch (error) {
        if (!(error instanceof NutritionCalculationError)) {
          throw error;
        }
        issue = error.message;
      }
    }
    return { ...item, issue, calculation };
  });
  return {
    items,
    unresolved: items.filter((item) => item.issue).length,
    totals: sumNutrition(
      items.flatMap((item) => (item.calculation ? [item.calculation.nutrients] : []))
    ),
  };
}

/** Validate the entire batch, then change a copy. The caller publishes it with a revision/lease check. */
export async function applyDraftInterpretation(
  current: { items: DraftItem[]; date: string; mealCategory: MealCategory },
  raw: DraftInterpretation,
  match: (item: DraftItem) => Promise<DraftItem>
) {
  const parsed = draftInterpretationSchema.parse(raw);
  const items = structuredClone(current.items);
  let date = current.date;
  let mealCategory = current.mealCategory;
  const questions = [...parsed.questions];
  for (const operation of parsed.operations) {
    if (operation.type === 'addItem') {
      if (items.length >= 40) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'A draft supports up to 40 foods.' });
      }
      items.push(
        await match({
          ...newDraftItem(operation.productQuery),
          quantity: operation.quantity,
          unit: operation.unit,
        })
      );
    } else if (operation.type === 'changeDate') {
      if (operation.date) {
        date = operation.date;
      } else {
        questions.push('Check the target date before confirming this meal.');
      }
    } else if (operation.type === 'changeMealCategory') {
      mealCategory = operation.mealCategory;
    } else {
      const index = items.findIndex((item) => item.id === operation.itemId);
      if (index < 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The model referred to an unknown draft item. Your draft was not changed.',
        });
      }
      const item = items[index];
      if (operation.type === 'removeItem') {
        items.splice(index, 1);
      } else if (operation.type === 'changeProduct') {
        items[index] = await match({
          ...item,
          query: operation.productQuery,
          snapshot: null,
          input: null,
          candidates: [],
        });
      } else {
        items[index] = {
          ...item,
          quantity: operation.quantity,
          unit: operation.unit,
          input: resolveDraftQuantity(item.snapshot, operation.quantity, operation.unit),
        };
      }
    }
  }
  return {
    items: draftItemsSchema.parse(items),
    date,
    mealCategory,
    questions: [...new Set(questions)].slice(0, 8),
    reply: parsed.reply,
  };
}
