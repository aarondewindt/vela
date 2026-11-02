import { sourcePhysicalUnit, sourceAmountUnit, explicitCorrectionReference } from './source-units';
import {
  indexSourceEvidence,
  sourceNumbers,
  type SourceEvidence,
  type SourceCell,
} from '@/lib/ai/source-evidence';
import { normalizeExtraction, columnExtractionToEvidence } from './normalize';
import { columnExtractionSchema, nutrientNames, type Extraction } from './schema';
import {
  nutritionInterpretationSchema,
  type NutritionInterpretation,
  type UserCorrection,
  type ExtractionPipelineMetadata,
} from './pipeline-schema';

const absent = () => ({ value: null, status: 'missing' as const, note: '' });
const riHeading = /(?:%|\bRI\b|\bDV\b|\bNRV\b|reference intake|referentie.inname)/i;
const servingText = /(?:serving|portion|portie|blokje|piece|stuk|per\s+\d)/i;
const nutritionText =
  /(?:energy|energie|fat|vet|carbohydrat|koolhydrat|protein|eiwit|fib(?:er|re)|vezel|sugars?|suiker|saturat|verzadig|salt|zout|sodium|natrium)/i;

function requireCell(cells: Map<string, SourceCell>, id: string): SourceCell {
  const cell = cells.get(id);
  if (!cell) {
    throw new Error('Interpretation references an unknown source cell.');
  }
  return cell;
}
function requireNumber(cell: SourceCell | UserCorrection, index: number | null): string | null {
  if (index === null) {
    return null;
  }
  const token = sourceNumbers(cell.text)[index];
  if (token === undefined) {
    throw new Error('Interpretation references an unknown printed-number token.');
  }
  return token;
}
function rowLabel(cells: Map<string, SourceCell>, cell: SourceCell) {
  return [...cells.values()].find(
    (candidate) => candidate.rowId === cell.rowId && !candidate.columnId
  );
}
function observation(cell: SourceCell, index: number | null, note = '') {
  const value = requireNumber(cell, index);
  return {
    value: value ?? (cell.text || null),
    status:
      cell.uncertain || index === null || !/^\d+(?:[.,]\d+)?$/.test(value ?? '')
        ? ('uncertain' as const)
        : ('printed' as const),
    note: `Source ${cell.id}. ${note}`.slice(0, 500),
  };
}

/** Validate the reference graph before producing any normalized suggestion. */
export function validateNutritionInterpretation(
  evidence: SourceEvidence,
  value: NutritionInterpretation,
  corrections: UserCorrection[]
) {
  const interpretation = nutritionInterpretationSchema.parse(value);
  const cells = indexSourceEvidence(evidence);
  const user = new Map(corrections.map((item) => [item.id, item]));
  const userNumber = (id: string, index: number | null) => {
    const correction = user.get(id);
    if (!correction) {
      throw new Error('Interpretation references an unknown user correction.');
    }
    requireNumber(correction, index);
    return correction;
  };
  for (const field of Object.values(interpretation.identity)) {
    if (Array.isArray(field)) {
      field.forEach((id) => requireCell(cells, id));
    } else if (field !== null) {
      requireCell(cells, field);
    }
  }
  if (interpretation.package.quantity) {
    const { cellId, numberIndex } = interpretation.package.quantity;
    const cell = requireCell(cells, cellId);
    requireNumber(cell, numberIndex);
    const unit = sourcePhysicalUnit(cell, numberIndex);
    if (interpretation.package.unit && unit !== interpretation.package.unit) {
      throw new Error('Package units must match the referenced physical observation.');
    }
  }
  const included = new Set<string>();
  const amounts = new Set<string>();
  const rowMappings = new Map<string, Set<string>>();
  const mappedCells = new Set<string>();
  for (const column of interpretation.columns) {
    const heading = requireCell(cells, column.columnId);
    if (heading.columnId !== heading.id || !heading.tableId || included.has(column.columnId)) {
      throw new Error('Interpretation must identify each original table column once.');
    }
    included.add(column.columnId);
    if (!riHeading.test(heading.text) && column.unit === '%') {
      throw new Error('A physical source column cannot be reclassified as reference intake.');
    }
    const printedReferences = sourceNumbers(heading.text).flatMap((value, index) =>
      /^\d+(?:[.,]\d+)?$/.test(value) &&
      ['G', 'ML'].includes(sourcePhysicalUnit(heading, index) ?? '')
        ? [index]
        : []
    );
    if (
      !heading.uncertain &&
      !riHeading.test(heading.text) &&
      printedReferences.length === 1 &&
      (!column.reference ||
        column.reference.cellId !== heading.id ||
        column.reference.numberIndex !== printedReferences[0])
    ) {
      throw new Error(
        'An unambiguous printed physical heading requires its original quantity reference.'
      );
    }
    if (column.reference) {
      const cell = requireCell(cells, column.reference.cellId);
      requireNumber(cell, column.reference.numberIndex);
      if (
        (cell.columnId && cell.id !== heading.id) ||
        (!cell.columnId && !servingText.test(cell.text))
      ) {
        throw new Error(
          'A column reference must use its own heading or an explicit physical serving description.'
        );
      }
      if (
        sourceNumbers(heading.text).length &&
        column.reference.cellId !== heading.id &&
        !riHeading.test(heading.text)
      ) {
        throw new Error(
          'A printed physical heading cannot be replaced by another source quantity.'
        );
      }
      const unit = sourcePhysicalUnit(cell, column.reference.numberIndex);
      if (column.unit && column.unit !== '%' && unit !== column.unit) {
        throw new Error('A physical reference unit must match its source.');
      }
      if (riHeading.test(heading.text)) {
        throw new Error('Reference-intake percentages cannot have physical references.');
      }
    }
    for (const value of column.values) {
      if (!value.amount) {
        continue;
      }
      const cell = requireCell(cells, value.amount.cellId);
      if (cell.columnId !== column.columnId || !cell.rowId || cell.tableId !== heading.tableId) {
        throw new Error('Nutrient amounts must belong to their original row and selected column.');
      }
      requireNumber(cell, value.amount.numberIndex);
      const percent = riHeading.test(heading.text);
      const sourceUnit = sourceAmountUnit(
        cell,
        value.amount.numberIndex,
        rowLabel(cells, cell)?.text
      );
      if (!percent && value.amount.numberIndex !== null && sourceUnit !== value.unit) {
        throw new Error('A nutrient amount unit must match its original cell or row label.');
      }
      if (
        !percent &&
        ((value.nutrient === 'calories' && !['kcal', 'kJ'].includes(value.unit)) ||
          (value.nutrient !== 'calories' && !['g', 'mg'].includes(value.unit)))
      ) {
        throw new Error('A nutrient mapping has an incompatible physical amount unit.');
      }
      const meanings = rowMappings.get(cell.rowId!) ?? new Set<string>();
      if (meanings.size && !meanings.has(value.nutrient)) {
        throw new Error(
          'The same source nutrition row cannot mean different nutrients in different columns.'
        );
      }
      meanings.add(value.nutrient);
      rowMappings.set(cell.rowId!, meanings);
      mappedCells.add(cell.id);
      const key = `${cell.id}:${value.amount.numberIndex}`;
      if (amounts.has(key)) {
        throw new Error('One source amount cannot be reassigned to multiple nutrients.');
      }
      amounts.add(key);
    }
  }
  const reported = new Set(interpretation.problems.flatMap((problem) => problem.cellIds));
  for (const cell of cells.values()) {
    if (!cell.rowId || !cell.columnId || !cell.text.trim() || !rowMappings.has(cell.rowId)) {
      continue;
    }
    const heading = cells.get(cell.columnId)!;
    if (riHeading.test(heading.text)) {
      continue;
    }
    if (
      !mappedCells.has(cell.id) &&
      !reported.has(cell.id) &&
      !reported.has(rowLabel(cells, cell)?.id ?? '')
    ) {
      throw new Error(
        'Interpretation omitted a corresponding observation from a physical nutrition row.'
      );
    }
  }
  // A second physical column must not silently disappear because it contradicts the preferred one.
  for (const photo of evidence.photographs) {
    for (const table of photo.tables) {
      if (!table.rows.some((row) => nutritionText.test(row.label.text))) {
        continue;
      }
      for (const heading of table.columns) {
        if (!included.has(heading.id)) {
          throw new Error('Interpretation omitted a source nutrition column.');
        }
      }
    }
  }
  for (const problem of interpretation.problems) {
    problem.cellIds.forEach((id) => requireCell(cells, id));
  }
  const correctionTargets = new Set<string>();
  for (const correction of interpretation.corrections) {
    const target = `${correction.correctionId}:${correction.field}`;
    if (correctionTargets.has(target)) {
      throw new Error('A user message cannot supply duplicate corrections for the same field.');
    }
    correctionTargets.add(target);
    const source = userNumber(correction.correctionId, correction.numberIndex);
    const numeric =
      correction.field === 'packageQuantity' ||
      nutrientNames.includes(correction.field as (typeof nutrientNames)[number]);
    if (numeric) {
      if (correction.numberIndex === null || correction.text !== null) {
        throw new Error(
          'Numeric corrections must reference an original user number, never replacement text.'
        );
      }
    } else if (!correction.text?.trim() || !source.text.includes(correction.text)) {
      throw new Error('Text corrections must quote an exact user-provided substring.');
    }
    if (numeric && correction.field !== 'packageQuantity') {
      const physicalReference = explicitCorrectionReference(source);
      if (
        physicalReference &&
        (correction.numberIndex === physicalReference.index ||
          correction.reference?.correctionId !== source.id ||
          correction.reference.numberIndex !== physicalReference.index ||
          correction.referenceUnit !== physicalReference.unit)
      ) {
        throw new Error('A numeric correction must retain its explicit physical reference.');
      }
      const explicitUnit = sourceAmountUnit(source, correction.numberIndex);
      if (explicitUnit && correction.unit && explicitUnit !== correction.unit) {
        throw new Error('A user correction unit must match the original user text.');
      }
    }
    if (correction.reference) {
      const referenceSource = userNumber(
        correction.reference.correctionId,
        correction.reference.numberIndex
      );
      const unit = sourcePhysicalUnit(referenceSource, correction.reference.numberIndex);
      if (!unit || unit !== correction.referenceUnit) {
        throw new Error('A correction physical reference must match the original user text.');
      }
    }
  }
  return interpretation;
}

/** Resolve the interpreting model's pointers, then reuse the deterministic nutrition normalizer. */
export function normalizeInterpretedEvidence(
  evidence: SourceEvidence,
  value: NutritionInterpretation,
  corrections: UserCorrection[]
) {
  const interpretation = validateNutritionInterpretation(evidence, value, corrections);
  const cells = indexSourceEvidence(evidence);
  const problemCells = new Set(interpretation.problems.flatMap((problem) => problem.cellIds));
  for (const cell of cells.values()) {
    cell.uncertain ||=
      problemCells.has(cell.id) ||
      (!!cell.columnId &&
        (cells.get(cell.columnId)?.uncertain || problemCells.has(cell.columnId))) ||
      (!!cell.rowId &&
        (rowLabel(cells, cell)?.uncertain || problemCells.has(rowLabel(cells, cell)?.id ?? '')));
  }
  const user = new Map(corrections.map((item) => [item.id, item]));
  const provenance: ExtractionPipelineMetadata['provenance'] = {};
  const record = (field: string, cell: SourceCell, numberIndex: number | null) => {
    (provenance[field] ??= []).push({
      cellId: cell.id,
      photographId: cell.photographId,
      numberIndex,
    });
  };
  const text = (field: string, id: string | null) => {
    if (!id) {
      return absent();
    }
    const cell = requireCell(cells, id);
    record(field, cell, null);
    return {
      value: cell.text.slice(0, 4000),
      status: cell.uncertain ? ('uncertain' as const) : ('printed' as const),
      note: `Source ${cell.id}`,
    };
  };
  const columns = interpretation.columns.map((column) => {
    const heading = requireCell(cells, column.columnId);
    const percent = riHeading.test(heading.text);
    const values = columnExtractionSchema.shape.tables.element.shape.values.parse({
      energyKcal: absent(),
      energyKj: absent(),
      ...Object.fromEntries(
        nutrientNames
          .filter((key) => key !== 'calories')
          .map((key) => [key, { ...absent(), unit: 'g' }])
      ),
    });
    const keys = new Set<string>();
    for (const value of column.values) {
      const key =
        value.nutrient === 'calories'
          ? value.unit === 'kJ'
            ? 'energyKj'
            : 'energyKcal'
          : value.nutrient;
      if (keys.has(key)) {
        throw new Error('A column maps multiple observations to the same nutrient and unit.');
      }
      keys.add(key);
      const amount = value.amount
        ? observation(requireCell(cells, value.amount.cellId), value.amount.numberIndex, value.note)
        : absent();
      if (value.amount) {
        record(value.nutrient, requireCell(cells, value.amount.cellId), value.amount.numberIndex);
      }
      if (key === 'energyKcal' || key === 'energyKj') {
        values[key] = amount;
      } else {
        values[key] = { ...amount, unit: percent ? '%' : (value.unit as 'g' | 'mg' | '%') };
      }
    }
    for (const cell of cells.values()) {
      if (
        cell.columnId !== column.columnId ||
        !cell.rowId ||
        !cell.uncertain ||
        column.values.some((value) => value.amount?.cellId === cell.id)
      ) {
        continue;
      }
      const meanings = interpretation.columns.flatMap((other) =>
        other.values.filter(
          (value) => value.amount && cells.get(value.amount.cellId)?.rowId === cell.rowId
        )
      );
      for (const value of meanings) {
        const key =
          value.nutrient === 'calories'
            ? value.unit === 'kJ'
              ? 'energyKj'
              : 'energyKcal'
            : value.nutrient;
        if (keys.has(key)) {
          continue;
        }
        keys.add(key);
        const amount = observation(
          { ...cell, uncertain: true },
          null,
          'Questionable source observation.'
        );
        if (key === 'energyKcal' || key === 'energyKj') {
          values[key] = amount;
        } else {
          values[key] = { ...amount, unit: percent ? '%' : (value.unit as 'g' | 'mg' | '%') };
        }
        record(value.nutrient, cell, null);
      }
    }
    const referenceCell = column.reference ? requireCell(cells, column.reference.cellId) : null;
    return {
      referenceQuantity: percent
        ? { value: heading.text, status: 'printed' as const, note: `Source ${heading.id}` }
        : referenceCell && column.reference
          ? observation(
              referenceCell,
              column.reference.numberIndex,
              `Printed heading: ${heading.text}`
            )
          : {
              value: heading.text || null,
              status: 'uncertain' as const,
              note: 'No reliable physical reference was mapped.',
            },
      unit: percent
        ? ('%' as const)
        : (column.unit ??
          (referenceCell && column.reference
            ? (sourcePhysicalUnit(referenceCell, column.reference.numberIndex) as 'G' | 'ML' | null)
            : null)),
      values,
      note: `Source column ${heading.id}. ${column.note}`.slice(0, 500),
    };
  });
  const packageQuantity = interpretation.package.quantity;
  const packageCell = packageQuantity ? requireCell(cells, packageQuantity.cellId) : null;
  if (packageCell && packageQuantity) {
    record('packageQuantity', packageCell, packageQuantity.numberIndex);
  }
  const canonical = columnExtractionToEvidence({
    tables: columns.length
      ? columns
      : [
          {
            referenceQuantity: absent(),
            unit: null,
            values: {
              energyKcal: absent(),
              energyKj: absent(),
              ...Object.fromEntries(
                nutrientNames
                  .filter((key) => key !== 'calories')
                  .map((key) => [key, { ...absent(), unit: 'g' }])
              ),
            },
            note: 'No readable nutrition table.',
          },
        ],
    name: text('name', interpretation.identity.name),
    brand: text('brand', interpretation.identity.brand),
    variant: text('variant', interpretation.identity.variant),
    description: text('description', interpretation.identity.description),
    ingredients: text('ingredients', interpretation.identity.ingredients),
    aliases: interpretation.identity.aliases
      .map((id) => requireCell(cells, id).text)
      .filter((item) => item.trim().length > 0 && item.length <= 240),
    package: {
      quantity:
        packageCell && packageQuantity
          ? observation(packageCell, packageQuantity.numberIndex)
          : absent(),
      unit: interpretation.package.unit,
    },
    warnings: [...evidence.warnings, ...interpretation.problems.map((problem) => problem.note)]
      .map((warning) => warning.slice(0, 500))
      .slice(0, 30),
  });
  const correctionOrder = new Map(corrections.map((correction, index) => [correction.id, index]));
  const orderedCorrections = [...interpretation.corrections].sort(
    (left, right) =>
      correctionOrder.get(left.correctionId)! - correctionOrder.get(right.correctionId)!
  );
  for (const correction of orderedCorrections) {
    const source = user.get(correction.correctionId)!;
    const numeric =
      correction.field === 'packageQuantity' ||
      nutrientNames.includes(correction.field as (typeof nutrientNames)[number]);
    const observed = {
      value: numeric ? requireNumber(source, correction.numberIndex) : correction.text,
      status: 'corrected' as const,
      note: `Explicit user correction in message ${source.messageId}.`,
    };
    provenance[correction.field] = [
      { correctionId: source.id, messageId: source.messageId, numberIndex: correction.numberIndex },
    ];
    if (!numeric) {
      canonical[correction.field as 'name' | 'brand' | 'variant' | 'description' | 'ingredients'] =
        observed;
    } else if (correction.field === 'packageQuantity') {
      const physicalUnit = sourcePhysicalUnit(source, correction.numberIndex);
      canonical.package = {
        quantity: observed,
        unit:
          physicalUnit === 'G' ||
          physicalUnit === 'KG' ||
          physicalUnit === 'ML' ||
          physicalUnit === 'L'
            ? physicalUnit
            : null,
      };
    } else {
      for (const table of canonical.tables) {
        table.values = table.values.filter((field) => field.nutrient !== correction.field);
      }
      const physical = canonical.tables.filter((table) => table.basis === 'per100' && table.unit);
      const units = new Set(physical.map((table) => table.unit));
      const perServing =
        /\bper[ -]+(?:serving|portion|portie|piece|stuk|blokje)\b/i.test(source.text) &&
        !explicitCorrectionReference(source);
      const servings = canonical.tables.filter(
        (table) =>
          table.basis === 'serving' &&
          table.unit &&
          table.servingQuantity.value &&
          ['printed', 'corrected'].includes(table.servingQuantity.status)
      );
      const servingKeys = new Set(
        servings.map((table) => `${table.servingQuantity.value}:${table.unit}`)
      );
      const serving = perServing && servingKeys.size === 1 ? servings[0] : null;
      const ref =
        !perServing && correction.reference ? user.get(correction.reference.correctionId)! : null;
      const referenceValue =
        ref && correction.reference
          ? requireNumber(ref, correction.reference.numberIndex)
          : (serving?.servingQuantity.value ?? null);
      const referenceUnit =
        ref && correction.reference
          ? sourcePhysicalUnit(ref, correction.reference.numberIndex)
          : perServing
            ? (serving?.unit ?? null)
            : units.size === 1
              ? physical[0].unit
              : null;
      const unit =
        sourceAmountUnit(source, correction.numberIndex) ??
        correction.unit ??
        (correction.field === 'calories' ? 'kcal' : 'g');
      if (!['g', 'mg', 'kcal', 'kJ'].includes(unit)) {
        throw new Error('A nutrient correction requires a physical nutrient amount unit.');
      }
      canonical.tables.push({
        basis:
          referenceValue && referenceValue !== '100'
            ? 'serving'
            : referenceUnit
              ? 'per100'
              : 'unknown',
        unit: referenceUnit === 'G' || referenceUnit === 'ML' ? referenceUnit : null,
        servingQuantity: referenceValue
          ? { value: referenceValue, status: 'corrected', note: observed.note }
          : absent(),
        values: [
          {
            ...observed,
            nutrient: correction.field as (typeof nutrientNames)[number],
            unit: unit as 'g' | 'mg' | 'kcal' | 'kJ',
          },
        ],
        note: observed.note,
      });
    }
  }
  return { suggestion: normalizeExtraction(canonical as Extraction), provenance, interpretation };
}
