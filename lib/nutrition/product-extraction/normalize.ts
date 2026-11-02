import { Decimal } from '@prisma/client/runtime/client';
import { storedNutritionDecimal } from '../calculations';
import { normalizeProductText } from '../normalization';
import { nutrientKeys } from '../types';
import {
  extractionSchema,
  columnExtractionSchema,
  nutrientNames,
  productSuggestionSchema,
  type Extraction,
  type ProductSuggestion,
} from './schema';

const D = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
function number(value: string | null) {
  if (value === null || !/^\d{1,12}(?:[.,]\d{1,8})?$/.test(value.trim())) {
    return null;
  }
  return new D(value.trim().replace(',', '.'));
}
function reliable(field: Extraction['name']) {
  return field.status === 'printed' || field.status === 'corrected';
}

/** Convert only observed quantities. Never fill unknown nutrients or infer a density. */
export function normalizeExtraction(input: unknown): ProductSuggestion {
  const evidence = extractionSchema.parse(input);
  const warnings = [...evidence.warnings];
  const product: ProductSuggestion['product'] = {
    calculationMode: 'DIRECT',
    verificationStatus: 'UNVERIFIED',
  };
  for (const key of ['name', 'brand'] as const) {
    const field = evidence[key];
    if (reliable(field) && field.value?.trim() && field.value.trim().length <= 240) {
      product[key] = field.value.trim();
    } else {
      warnings.push(`${key}: missing, uncertain or invalid; review manually.`);
    }
  }
  for (const key of ['description', 'variant', 'ingredients'] as const) {
    if (evidence[key].status === 'uncertain') {
      warnings.push(`${key}: ${evidence[key].note || 'Unreadable or conflicting evidence.'}`);
    }
  }
  const descriptions = (['description', 'variant', 'ingredients'] as const).flatMap((key) => {
    const field = evidence[key];
    return reliable(field) && field.value?.trim()
      ? [`${key === 'description' ? '' : `${key}: `}${field.value.trim()}`]
      : [];
  });
  if (descriptions.length) {
    product.description = descriptions.join('\n').slice(0, 4000);
  }
  const seen = new Set<string>();
  product.aliases = evidence.aliases.filter((alias) => {
    const key = normalizeProductText(alias);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  const packageQuantity = reliable(evidence.package.quantity)
    ? number(evidence.package.quantity.value)
    : null;
  if (packageQuantity?.gt(0) && evidence.package.unit) {
    const unit = evidence.package.unit;
    try {
      product.servings = [
        {
          name: 'package',
          aliases: [],
          quantity: storedNutritionDecimal(
            packageQuantity.times(unit === 'KG' || unit === 'L' ? 1000 : 1)
          ),
          canonicalUnit: unit === 'G' || unit === 'KG' ? 'G' : 'ML',
          isDefault: false,
          isEstimated: false,
        },
      ];
    } catch {
      warnings.push('Package quantity exceeds the supported range.');
    }
  }
  const tables = evidence.tables.filter(
    (table) =>
      table.unit &&
      (table.basis === 'per100' ||
        (table.basis === 'serving' &&
          reliable(table.servingQuantity) &&
          number(table.servingQuantity.value)?.gt(0)))
  );
  if (
    evidence.tables.some((table) => table.basis !== 'referenceIntake' && !tables.includes(table))
  ) {
    warnings.push(
      'Some nutrition columns have an unknown or unreadable physical reference; they were not converted.'
    );
  }
  const units = new Set(tables.map((table) => table.unit));
  const referenceUnit = units.size === 1 ? tables[0].unit : null;
  if (referenceUnit) {
    product.referenceQuantity = '100';
    product.referenceUnit = referenceUnit;
  } else {
    warnings.push(
      'Nutrition reference is missing or conflicts between g and ml. No normalized nutrients can be applied.'
    );
  }
  const nutrition = {} as ProductSuggestion['nutrition'];
  for (const nutrient of nutrientNames) {
    const candidates: {
      value: Decimal;
      status: 'printed' | 'corrected' | 'calculated';
      direct: boolean;
      kj: boolean;
      rounding: Decimal;
    }[] = [];
    const unknownReference = evidence.tables.some(
      (table) =>
        table.basis !== 'referenceIntake' &&
        !tables.includes(table) &&
        table.values.some((field) => field.nutrient === nutrient && field.status !== 'missing')
    );
    let uncertain = false;
    for (const table of tables) {
      for (const field of table.values.filter((entry) => entry.nutrient === nutrient)) {
        if (field.status === 'missing' || field.value === null) {
          if (field.status === 'uncertain') {
            uncertain = true;
          }
          continue;
        }
        const raw = number(field.value);
        const unitValid =
          nutrient === 'calories'
            ? ['kcal', 'kJ'].includes(field.unit)
            : ['g', 'mg'].includes(field.unit);
        if (!reliable(field) || !raw || !unitValid) {
          uncertain = true;
          continue;
        }
        const calculated = table.basis === 'serving' || field.unit === 'kJ' || field.unit === 'mg';
        const factor = new D(1)
          .div(field.unit === 'kJ' ? '4.184' : field.unit === 'mg' ? 1000 : 1)
          .times(
            table.basis === 'serving' ? new D(100).div(number(table.servingQuantity.value)!) : 1
          );
        const value = raw.times(factor);
        // Printed portion values are rounded before converting back to per-100.
        // Preserve trailing zeros: 2.0 g has a half-step of 0.05 g, not 0.5 g.
        const decimals = field.value.trim().split(/[.,]/)[1]?.length ?? 0;
        const halfStep = new D('0.5').div(new D(10).pow(decimals));
        let rounding = halfStep.times(factor);
        // A fractional piece weight (e.g. 4.2 g) is itself rounded. Propagate
        // that printed precision when cross-checking its normalized amounts.
        const sizeDecimals = table.servingQuantity.value?.trim().split(/[.,]/)[1]?.length ?? 0;
        if (table.basis === 'serving' && sizeDecimals > 0) {
          const size = number(table.servingQuantity.value)!;
          const halfSizeStep = new D('0.5').div(new D(10).pow(sizeDecimals));
          const upper = raw.plus(halfStep).times(factor).times(size).div(size.minus(halfSizeStep));
          const lower = D.max(0, raw.minus(halfStep))
            .times(factor)
            .times(size)
            .div(size.plus(halfSizeStep));
          rounding = D.max(rounding, upper.minus(value), value.minus(lower));
        }
        candidates.push({
          value,
          rounding,
          status: calculated ? 'calculated' : (field.status as 'printed' | 'corrected'),
          direct: table.basis === 'per100',
          kj: field.unit === 'kJ',
        });
      }
    }
    // Prefer printed per-100 kcal; retain disagreements instead of selecting a photograph silently.
    candidates.sort((a, b) => Number(b.direct) - Number(a.direct) || Number(a.kj) - Number(b.kj));
    const first = candidates[0];
    const conflict =
      first &&
      candidates.some((candidate) => {
        const baseTolerance =
          candidate.kj !== first.kj
            ? D.max(2, first.value.times('0.01'))
            : candidate.direct && first.direct
              ? new D(0)
              : new D(nutrient === 'calories' ? 1 : '0.1');
        // Same-basis contradictions remain strict. Only portion conversion gets
        // the combined printed rounding intervals, in the normalized unit.
        const tolerance =
          candidate.direct && first.direct
            ? baseTolerance
            : D.max(baseTolerance, first.rounding.plus(candidate.rounding));
        return candidate.value.minus(first.value).abs().gt(tolerance);
      });
    let normalized: ProductSuggestion['nutrition'][typeof nutrient] = {
      value: null,
      status: 'missing',
      note: 'No readable value with a known physical reference.',
    };
    if (
      conflict ||
      uncertain ||
      (!referenceUnit && first) ||
      (unknownReference && !first?.direct)
    ) {
      normalized = {
        value: null,
        status: 'uncertain',
        note:
          !referenceUnit && first
            ? 'The physical references disagree between g and ml; these values were not combined.'
            : conflict
              ? `Conflicting readings per 100 ${referenceUnit}: ${[...new Set(candidates.map((candidate) => candidate.value.toDecimalPlaces(4).toString()))].slice(0, 6).join(', ')} ${nutrient === 'calories' ? 'kcal' : 'g'}. Review the source columns.`
              : uncertain
                ? 'A reading is uncertain or has an invalid number/unit; review the label.'
                : 'No reliable per-100 reading and an additional column has no usable physical reference.',
      };
    } else if (first) {
      try {
        normalized = {
          value: storedNutritionDecimal(first.value),
          status: first.status,
          note: `Per 100 ${referenceUnit}${
            first.status === 'calculated'
              ? '; converted from the recorded unit or serving quantity.'
              : '; directly observed.'
          }${unknownReference ? ' An additional column has no usable physical reference and was excluded.' : ''}`,
        };
      } catch {
        normalized = {
          value: null,
          status: 'uncertain',
          note: 'Value exceeds the supported range.',
        };
      }
    }
    nutrition[nutrient] = normalized;
    if (nutrientKeys.includes(nutrient as (typeof nutrientKeys)[number])) {
      if (normalized.value !== null) {
        product[nutrient as (typeof nutrientKeys)[number]] = normalized.value;
      } else {
        warnings.push(`${nutrient}: ${normalized.note}`);
      }
    }
  }
  if (nutrition.sodium.value !== null) {
    warnings.push('Sodium was retained separately; it was not treated as salt.');
  }
  if (
    evidence.tables.some((table) =>
      table.values.some((value) =>
        ['sugars', 'saturatedFat', 'salt', 'sodium'].includes(value.nutrient)
      )
    )
  ) {
    warnings.push(
      'Sugars, saturated fat, salt and sodium have no Product fields; retained only as extraction evidence.'
    );
  }
  return productSuggestionSchema.parse({
    version: 1,
    product,
    evidence,
    nutrition,
    warnings: [...new Set(warnings)],
  });
}

/** Classify a transcribed physical heading without asking the model to infer a basis. */
export function columnExtractionToEvidence(input: unknown): Extraction {
  const columns = columnExtractionSchema.parse(input);
  return extractionSchema.parse({
    ...columns,
    tables: columns.tables.map(({ referenceQuantity, ...column }) => {
      const values = Object.entries(column.values).map(([key, field]) => ({
        ...field,
        nutrient: key === 'energyKcal' || key === 'energyKj' ? 'calories' : key,
        unit:
          key === 'energyKcal'
            ? 'kcal'
            : key === 'energyKj'
              ? 'kJ'
              : 'unit' in field
                ? field.unit
                : 'g',
      }));
      // RI/%DV is an explicit dimensionless heading, never a physical amount.
      // Handle a copied literal RI heading even if the model mislabeled its unit.
      const percent =
        column.unit === '%' ||
        (reliable(referenceQuantity) &&
          /^(?:%?RI\*?|%?DV|NRV|reference intake|referentie-inname)$/i.test(
            referenceQuantity.value?.trim() ?? ''
          ));
      if (percent) {
        return {
          ...column,
          basis: 'referenceIntake',
          unit: null,
          servingQuantity: {
            value: null,
            status: 'missing',
            note: 'Reference intake percentages, not a physical serving.',
          },
          values: values.map((field) => ({ ...field, unit: '%' })),
        };
      }
      const printedHeading = reliable(referenceQuantity) ? referenceQuantity.value?.trim() : null;
      // A named portion is usable only when the heading itself states a physical
      // size. Never obtain it from a free-form note, package weight or serving count.
      const heading = printedHeading
        ? (printedHeading.match(/^(?:per\s*)?(\d{1,12}(?:[.,]\d{1,8})?)\s*(g|ml)?$/i) ??
          printedHeading.match(
            /^(?:per\s+)?[a-zÀ-ÿ][a-zÀ-ÿ\s’'/-]{0,80}\(\s*(\d{1,12}(?:[.,]\d{1,8})?)\s*(g|ml)\s*\)$/i
          ))
        : null;
      const quantity = heading ? number(heading[1]) : null;
      const headingUnit = heading?.[2]?.toUpperCase();
      const unit = column.unit ?? headingUnit ?? null;
      const known =
        !!quantity?.gt(0) &&
        (unit === 'G' || unit === 'ML') &&
        (!headingUnit || headingUnit === unit);
      const per100 = known && quantity!.eq(100);
      return {
        ...column,
        values,
        unit,
        basis: !known ? 'unknown' : per100 ? 'per100' : 'serving',
        servingQuantity: per100
          ? { value: null, status: 'missing', note: 'Per-100 reference, not a serving size.' }
          : known
            ? {
                ...referenceQuantity,
                value: heading![1].replace(',', '.'),
                note: `Printed heading: ${referenceQuantity.value}. ${referenceQuantity.note}`.slice(
                  0,
                  500
                ),
              }
            : referenceQuantity,
      };
    }),
  });
}

export function normalizeColumnExtraction(input: unknown): ProductSuggestion {
  return normalizeExtraction(columnExtractionToEvidence(input));
}
