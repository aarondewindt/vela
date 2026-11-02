/** @jest-environment node */
import { normalizeInterpretedEvidence } from './interpretation';
import {
  nutritionInterpretationSchema,
  nutritionInterpretationSchemaForEvidence,
} from './pipeline-schema';
import { milkSource, milkInterpretation } from './pipeline-fixtures';

it.each(['nl', 'en'] as const)(
  'normalizes %s labels and every physical column from original cells while retaining RI separately',
  (language) => {
    const { suggestion, provenance } = normalizeInterpretedEvidence(
      milkSource(language),
      milkInterpretation(),
      []
    );
    expect(suggestion.product).toMatchObject({
      name: 'Halfvolle melk',
      brand: 'Jumbo',
      calories: '47',
      fat: '1.5',
      carbohydrates: '4.7',
      protein: '3.5',
      referenceUnit: 'ML',
    });
    expect(suggestion.product.servings?.[0]).toMatchObject({
      quantity: '1000',
      canonicalUnit: 'ML',
    });
    expect(suggestion.product).not.toHaveProperty('fiber');
    expect(suggestion.evidence.tables[2].basis).toBe('referenceIntake');
    expect(provenance.protein).toContainEqual({
      cellId: 'back-cell-3-0',
      photographId: 'back',
      numberIndex: 0,
    });
  }
);
it('retains serving-only amounts and uses sufficient physical reference information for conversion', () => {
  const evidence = milkSource();
  evidence.photographs[1].tables[0].columns = [evidence.photographs[1].tables[0].columns[1]];
  for (const row of evidence.photographs[1].tables[0].rows) {
    row.cells = [row.cells[1]];
  }
  const mapping = milkInterpretation();
  mapping.columns = [mapping.columns[1]];
  expect(normalizeInterpretedEvidence(evidence, mapping, []).suggestion.product.protein).toBe(
    '3.5'
  );
  mapping.columns[0].reference = null;
  expect(() => normalizeInterpretedEvidence(evidence, mapping, [])).toThrow(
    'original quantity reference'
  );
  evidence.photographs[1].tables[0].columns[0].text = 'per serving';
  expect(normalizeInterpretedEvidence(evidence, mapping, []).suggestion.product).not.toHaveProperty(
    'protein'
  );
});

it('rejects reclassifying a printed physical column as RI', () => {
  const mapping = milkInterpretation();
  mapping.columns[1].unit = '%';
  expect(() => normalizeInterpretedEvidence(milkSource(), mapping, [])).toThrow('reclassified');
});
it('derives omitted physical units so contradictory amounts cannot disappear', () => {
  const evidence = milkSource();
  evidence.photographs[1].tables[0].rows[3].cells[1].text = '12 g';
  const mapping = milkInterpretation();
  mapping.columns[1].unit = null;
  expect(normalizeInterpretedEvidence(evidence, mapping, []).suggestion.product).not.toHaveProperty(
    'protein'
  );
});

it('uses authoritative correction chronology and source units even if the model omits units', () => {
  const mapping = milkInterpretation();
  const corrections = [
    { id: 'old', messageId: 'm1', text: 'Protein is 2 g per 100 ml.' },
    { id: 'new', messageId: 'm2', text: 'Protein is 350 mg per 100 ml.' },
  ];
  const correction = (id: string) => ({
    field: 'protein' as const,
    correctionId: id,
    text: null,
    numberIndex: 0,
    unit: null,
    reference: { correctionId: id, numberIndex: 1 },
    referenceUnit: 'ML' as const,
  });
  mapping.corrections = [correction('new'), correction('old')];
  expect(
    normalizeInterpretedEvidence(milkSource(), mapping, corrections).suggestion.product.protein
  ).toBe('0.35');
  mapping.corrections.push(correction('new'));
  expect(() => normalizeInterpretedEvidence(milkSource(), mapping, corrections)).toThrow(
    'duplicate corrections'
  );
});
it('withholds uncertain, censored and conflicting amounts while preserving original lexical precision', () => {
  const evidence = milkSource();
  evidence.photographs[1].tables[0].rows[3].cells[0].text = '5,80 g';
  const { suggestion } = normalizeInterpretedEvidence(evidence, milkInterpretation(), []);
  expect(suggestion.product).not.toHaveProperty('protein');
  expect(
    suggestion.evidence.tables[0].values.find((field) => field.nutrient === 'protein')?.value
  ).toBe('5,80');
  evidence.photographs[1].tables[0].rows[3].cells[0].text = '<0,5 g';
  expect(
    normalizeInterpretedEvidence(evidence, milkInterpretation(), []).suggestion.nutrition.protein
      .status
  ).toBe('uncertain');
});
it.each([
  'unknown-cell',
  'wrong-column',
  'invalid-token',
  'omitted-column',
  'reused-value',
  'wrong-reference',
  'wrong-unit',
] as const)('rejects invalid source graph: %s', (failure) => {
  const mapping = milkInterpretation();
  if (failure === 'unknown-cell') {
    mapping.columns[0].values[0].amount!.cellId = 'invented';
  }
  if (failure === 'wrong-column') {
    mapping.columns[0].values[0].amount!.cellId = 'back-cell-0-1';
  }
  if (failure === 'invalid-token') {
    mapping.columns[0].values[0].amount!.numberIndex = 9;
  }
  if (failure === 'omitted-column') {
    mapping.columns.pop();
  }
  if (failure === 'reused-value') {
    mapping.columns[0].values[1].amount!.numberIndex = 0;
  }
  if (failure === 'wrong-reference') {
    mapping.columns[1].reference!.cellId = 'back-100';
  }
  if (failure === 'wrong-unit') {
    mapping.columns[0].unit = 'G';
  }
  expect(() => normalizeInterpretedEvidence(milkSource(), mapping, [])).toThrow();
});
it('does not accept replacement numeric observations in interpretation output', () => {
  const mapping = milkInterpretation();
  const invalid = {
    ...mapping,
    columns: [
      { ...mapping.columns[0], values: [{ ...mapping.columns[0].values[0], value: '123' }] },
    ],
  };
  expect(nutritionInterpretationSchema.safeParse(invalid).success).toBe(false);
});

it('constrains generation to each column and accepts units printed before their original amounts', () => {
  const evidence = milkSource();
  evidence.photographs[1].tables[0].rows[0].cells[0].text = 'kJ 195 / kcal 47';
  expect(
    normalizeInterpretedEvidence(evidence, milkInterpretation(), []).suggestion.product.calories
  ).toBe('47');
  const mapping = milkInterpretation();
  mapping.columns[0].values[0].amount!.cellId = 'back-cell-0-1';
  expect(nutritionInterpretationSchemaForEvidence(evidence).safeParse(mapping).success).toBe(false);
});

it('constrains numeric tokens and physical headings before provider output is accepted', () => {
  const evidence = milkSource();
  const schema = nutritionInterpretationSchemaForEvidence(evidence);
  expect(schema.safeParse(milkInterpretation()).success).toBe(true);
  const wrongUnit = milkInterpretation();
  wrongUnit.columns[0].values[0].unit = 'kcal';
  expect(schema.safeParse(wrongUnit).success).toBe(false);
  const wrongToken = milkInterpretation();
  wrongToken.columns[0].values[0].amount!.numberIndex = 99;
  expect(schema.safeParse(wrongToken).success).toBe(false);
  const missingHeading = milkInterpretation();
  missingHeading.columns[1].reference = null;
  expect(schema.safeParse(missingHeading).success).toBe(false);
  const nutritionAsPackage = milkInterpretation();
  nutritionAsPackage.package = { quantity: { cellId: 'back-100', numberIndex: 0 }, unit: 'ML' };
  expect(schema.safeParse(nutritionAsPackage).success).toBe(false);
});

it('derives a kJ correction unit from the trusted original message when the model leaves it null', () => {
  const mapping = milkInterpretation();
  mapping.corrections = [
    {
      field: 'calories',
      correctionId: 'user',
      text: null,
      numberIndex: 0,
      unit: null,
      reference: { correctionId: 'user', numberIndex: 1 },
      referenceUnit: 'ML',
    },
  ];
  const { suggestion } = normalizeInterpretedEvidence(milkSource(), mapping, [
    { id: 'user', messageId: 'message', text: 'Energy is kJ 418.4 per 100 ml.' },
  ]);
  expect(suggestion.product.calories).toBe('100');
});

it('uses a known source serving for serving corrections and withholds them when its size is unknown', () => {
  const source = milkSource();
  const mapping = milkInterpretation();
  const corrections = [
    { id: 'serving', messageId: 'message', text: 'Protein is 7 g per serving.' },
  ];
  mapping.corrections = [
    {
      field: 'protein',
      correctionId: 'serving',
      text: null,
      numberIndex: 0,
      unit: 'g',
      reference: null,
      referenceUnit: null,
    },
  ];
  expect(
    normalizeInterpretedEvidence(source, mapping, corrections).suggestion.product.protein
  ).toBe('3.5');
  source.photographs[1].tables[0].columns[1].text = 'per serving';
  mapping.columns[1].reference = null;
  mapping.columns[1].unit = null;
  expect(
    normalizeInterpretedEvidence(source, mapping, corrections).suggestion.product
  ).not.toHaveProperty('protein');
});
it('preserves photographed evidence and explicit user corrections as separate sources', () => {
  const evidence = milkSource();
  const original = structuredClone(evidence);
  const mapping = milkInterpretation();
  const corrections = [
    { id: 'u2', messageId: 'm2', text: 'The brand is Albert Heijn; protein is 3,6 g per 100 ml.' },
  ];
  mapping.corrections = [
    {
      field: 'brand',
      correctionId: 'u2',
      text: 'Albert Heijn',
      numberIndex: null,
      unit: null,
      reference: null,
      referenceUnit: null,
    },
    {
      field: 'protein',
      correctionId: 'u2',
      text: null,
      numberIndex: 0,
      unit: 'g',
      reference: { correctionId: 'u2', numberIndex: 1 },
      referenceUnit: 'ML',
    },
  ];
  const { suggestion, provenance } = normalizeInterpretedEvidence(evidence, mapping, corrections);
  expect(suggestion.product).toMatchObject({ brand: 'Albert Heijn', protein: '3.6' });
  expect(suggestion.nutrition.protein.status).toBe('corrected');
  expect(provenance.protein).toEqual([{ correctionId: 'u2', messageId: 'm2', numberIndex: 0 }]);
  expect(evidence).toEqual(original);
  mapping.corrections[0].text = 'Invented brand';
  expect(() => normalizeInterpretedEvidence(evidence, mapping, corrections)).toThrow(
    'exact user-provided'
  );
});

it('propagates source row uncertainty and interpretation problems to withheld nutrition', () => {
  const source = milkSource();
  source.photographs[1].tables[0].rows[3].label.uncertain = true;
  expect(
    normalizeInterpretedEvidence(source, milkInterpretation(), []).suggestion.product
  ).not.toHaveProperty('protein');
  const mapping = milkInterpretation();
  mapping.problems = [
    { cellIds: ['back-cell-3-0'], note: 'The printed protein digit is questionable.' },
  ];
  expect(
    normalizeInterpretedEvidence(milkSource(), mapping, []).suggestion.nutrition.protein.status
  ).toBe('uncertain');
});
it('rejects unit substitutions and omitted contradictory values from corresponding rows', () => {
  const mapping = milkInterpretation();
  mapping.columns[0].values[2].unit = 'mg';
  expect(() => normalizeInterpretedEvidence(milkSource(), mapping, [])).toThrow('unit must match');
  mapping.columns[0].values[2].unit = 'g';
  mapping.columns[1].values.pop();
  expect(() => normalizeInterpretedEvidence(milkSource(), mapping, [])).toThrow(
    'omitted a corresponding'
  );
  mapping.problems = [{ cellIds: ['back-cell-3-1'], note: 'Questionable serving protein.' }];
  expect(
    normalizeInterpretedEvidence(milkSource(), mapping, []).suggestion.nutrition.protein.status
  ).toBe('uncertain');
});

it.each([
  ['gram', 'G'],
  ['grams', 'G'],
  ['grammes', 'G'],
  ['kilograms', 'KG'],
  ['liter', 'L'],
  ['litres', 'L'],
  ['milliliter', 'ML'],
  ['millilitres', 'ML'],
] as const)('validates physical unit word %s from the original source', (literal, unit) => {
  const source = milkSource();
  source.photographs[0].text[2].text = `1 ${literal}`;
  const mapping = milkInterpretation();
  mapping.package.unit = unit;
  expect(
    normalizeInterpretedEvidence(source, mapping, []).suggestion.product.servings?.[0].canonicalUnit
  ).toBe(unit === 'KG' ? 'G' : unit === 'L' ? 'ML' : unit);
});
it('validates full amount unit words while rejecting arbitrary g-to-mg substitutions', () => {
  const source = milkSource();
  source.photographs[1].tables[0].rows[3].cells[0].text = '3,5 grams';
  expect(
    normalizeInterpretedEvidence(source, milkInterpretation(), []).suggestion.product.protein
  ).toBe('3.5');
});

it('constrains inference identity and numeric references to this evidence snapshot before normalization', async () => {
  const { nutritionInterpretationSchemaForEvidence } = await import('./pipeline-schema');
  const schema = nutritionInterpretationSchemaForEvidence(milkSource());
  const mapping = milkInterpretation();
  expect(schema.safeParse(mapping).success).toBe(true);
  mapping.identity.description = 'literal source text instead of its identifier';
  expect(schema.safeParse(mapping).success).toBe(false);
  mapping.identity.description = null;
  mapping.columns[0].values[0].amount!.cellId = 'invented';
  expect(schema.safeParse(mapping).success).toBe(false);
});
