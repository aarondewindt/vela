/** @jest-environment node */
import { normalizeExtraction } from './normalize';
import { dutchMilk, missing, printed } from './fixtures';

it('combines Dutch front/back observations with decimal commas and per-100-ml nutrition', () => {
  const suggestion = normalizeExtraction(dutchMilk());
  expect(suggestion.product).toMatchObject({
    name: 'Halfvolle melk',
    brand: 'Jumbo',
    referenceQuantity: '100',
    referenceUnit: 'ML',
    calories: '47',
    protein: '3.5',
    carbohydrates: '4.7',
    fat: '1.5',
    verificationStatus: 'UNVERIFIED',
    aliases: ['halfvolle melk'],
    servings: [{ name: 'package', quantity: '1000', canonicalUnit: 'ML', isEstimated: false }],
  });
  expect(suggestion.product.description).toContain('ingredients: MELK');
  expect(suggestion.product).not.toHaveProperty('fiber');
  expect(suggestion.nutrition.fiber).toMatchObject({ value: null, status: 'missing' });
  expect(suggestion.nutrition.salt.value).toBe('0.1');
  expect(suggestion.product).not.toHaveProperty('salt');
});
it('converts only known per-serving quantities to 100 g deterministically', () => {
  const data = dutchMilk();
  data.tables = [
    {
      basis: 'serving',
      unit: 'G',
      servingQuantity: printed('25'),
      note: '',
      values: [{ nutrient: 'protein', unit: 'g', ...printed('2,5') }],
    },
  ];
  const result = normalizeExtraction(data);
  expect(result.product).toMatchObject({ protein: '10', referenceUnit: 'G' });
  expect(result.nutrition.protein.status).toBe('calculated');
  data.tables[0].servingQuantity = missing;
  expect(normalizeExtraction(data).product).not.toHaveProperty('protein');
});
it('converts kJ-only energy and mg quantities without sodium/salt substitution', () => {
  const data = dutchMilk();
  data.tables[0].values = [
    { nutrient: 'calories', unit: 'kJ', ...printed('418.4') },
    { nutrient: 'sodium', unit: 'mg', ...printed('100') },
  ];
  const result = normalizeExtraction(data);
  expect(result.product.calories).toBe('100');
  expect(result.nutrition.calories.status).toBe('calculated');
  expect(result.nutrition.sodium.value).toBe('0.1');
  expect(result.nutrition.salt.value).toBeNull();
});
it.each(['<0,5', '1,2.3', '-1', '??', 'NaN', '1e3'])(
  'withholds unreadable or ambiguous numeric input %s',
  (value) => {
    const data = dutchMilk();
    data.tables[0].values = [{ nutrient: 'protein', unit: 'g', ...printed(value) }];
    expect(normalizeExtraction(data).nutrition.protein).toMatchObject({
      value: null,
      status: 'uncertain',
    });
  }
);
it('preserves printed zero and withholds uncertain digits', () => {
  const data = dutchMilk();
  data.tables[0].values = [
    { nutrient: 'fat', unit: 'g', ...printed('0') },
    { nutrient: 'fiber', unit: 'g', value: null, status: 'uncertain', note: 'Obscured' },
  ];
  const result = normalizeExtraction(data);
  expect(result.product.fat).toBe('0');
  expect(result.nutrition.fiber.status).toBe('uncertain');
});
it('withholds conflicting tables, energy units and physical references', () => {
  const data = dutchMilk();
  data.tables.push({
    ...data.tables[0],
    values: [{ nutrient: 'protein', unit: 'g', ...printed('7') }],
  });
  expect(normalizeExtraction(data).nutrition.protein.status).toBe('uncertain');
  data.tables[1].unit = 'G';
  expect(normalizeExtraction(data).product).not.toHaveProperty('calories');
  data.tables = [data.tables[0]];
  data.tables[0].values[0].value = '1000';
  expect(normalizeExtraction(data).nutrition.calories.status).toBe('uncertain');
});
it('compares per-serving and per-100 columns and prefers directly printed values', () => {
  const data = dutchMilk();
  data.tables.push({
    basis: 'serving',
    unit: 'ML',
    servingQuantity: printed('200'),
    note: '',
    values: [{ nutrient: 'protein', unit: 'g', ...printed('7') }],
  });
  expect(normalizeExtraction(data).nutrition.protein).toMatchObject({
    value: '3.5',
    status: 'printed',
  });
  data.tables[1].values[0].value = '10';
  expect(normalizeExtraction(data).product).not.toHaveProperty('protein');
});
it('keeps user corrections distinguishable and validates incomplete responses', () => {
  const data = dutchMilk();
  data.brand = { value: 'Albert Heijn', status: 'corrected', note: 'User correction' };
  const result = normalizeExtraction(data);
  expect(result.product.brand).toBe('Albert Heijn');
  expect(result.evidence.brand.status).toBe('corrected');
  expect(() => normalizeExtraction({ name: 'milk' })).toThrow();
  expect(() => normalizeExtraction({ ...data, extra: 'injected' })).toThrow();
});

it('handles English per-100-g labels including optional fiber and kg package sizes', () => {
  const data = dutchMilk();
  data.name = printed('Oat biscuits');
  data.package = { quantity: printed('0.4'), unit: 'KG' };
  data.tables = [
    {
      basis: 'per100',
      unit: 'G',
      servingQuantity: missing,
      note: 'Typical values per 100 g',
      values: [
        { nutrient: 'calories', unit: 'kcal', ...printed('450') },
        { nutrient: 'fiber', unit: 'g', ...printed('6.2') },
        { nutrient: 'protein', unit: 'g', ...printed('7.5') },
      ],
    },
  ];
  const result = normalizeExtraction(data);
  expect(result.product).toMatchObject({
    name: 'Oat biscuits',
    referenceUnit: 'G',
    fiber: '6.2',
    protein: '7.5',
    calories: '450',
    servings: [{ quantity: '400', canonicalUnit: 'G' }],
  });
});
it('retains unknown-reference values as uncertain evidence and never uses package size as serving size', () => {
  const data = dutchMilk();
  data.tables[0].basis = 'serving';
  const result = normalizeExtraction(data);
  expect(result.product).not.toHaveProperty('calories');
  expect(result.nutrition.calories.status).toBe('uncertain');
  expect(result.evidence.tables[0].values[1].value).toBe('47');
});

it('allows only propagated printed rounding when comparing small portions with per-100 values', () => {
  const data = dutchMilk();
  data.tables = [
    {
      basis: 'per100',
      unit: 'G',
      servingQuantity: missing,
      note: '',
      values: [
        { nutrient: 'protein', unit: 'g', ...printed('23,0') },
        { nutrient: 'fiber', unit: 'g', ...printed('7,8') },
      ],
    },
    {
      basis: 'serving',
      unit: 'G',
      servingQuantity: printed('25'),
      note: '',
      values: [
        { nutrient: 'protein', unit: 'g', ...printed('5,8') },
        { nutrient: 'fiber', unit: 'g', ...printed('2,0') },
      ],
    },
  ];
  expect(normalizeExtraction(data).product).toMatchObject({ protein: '23', fiber: '7.8' });
  // 2.1 * 4 = 8.4 differs by more than the combined 0.25 g rounding interval.
  data.tables[1].values[1].value = '2,1';
  expect(normalizeExtraction(data).nutrition.fiber.status).toBe('uncertain');
  // More printed decimals must tighten, rather than inherit one-decimal rounding.
  data.tables[1].values[0].value = '5,80';
  expect(normalizeExtraction(data).nutrition.protein.status).toBe('uncertain');
});

it('does not excuse disagreeing per-100 values as serving rounding', () => {
  const data = dutchMilk();
  data.tables[0].values = [{ nutrient: 'protein', unit: 'g', ...printed('23.0') }];
  data.tables.push({
    ...data.tables[0],
    values: [{ nutrient: 'protein', unit: 'g', ...printed('23.2') }],
  });
  expect(normalizeExtraction(data).product).not.toHaveProperty('protein');
});

it('propagates serving rounding through mg-to-g conversion without changing the observed per-100 value', () => {
  const data = dutchMilk();
  data.tables[0].values = [{ nutrient: 'salt', unit: 'g', ...printed('0.95') }];
  data.tables.push({
    basis: 'serving',
    unit: 'ML',
    servingQuantity: printed('25'),
    note: '',
    values: [{ nutrient: 'salt', unit: 'mg', ...printed('240') }],
  });
  expect(normalizeExtraction(data).nutrition.salt.value).toBe('0.95');
  data.tables[1].values[0].value = '300';
  expect(normalizeExtraction(data).nutrition.salt.status).toBe('uncertain');
});

it('derives each basis from its copied physical heading, not a model basis classification', async () => {
  const { normalizeColumnExtraction } = await import('./normalize');
  const { milkColumns } = await import('./fixtures');
  const columns = milkColumns();
  columns.tables.push({
    ...columns.tables[0],
    referenceQuantity: printed('25'),
    values: { ...columns.tables[0].values, protein: { unit: 'g', ...printed('0.9') } },
  });
  const result = normalizeColumnExtraction(columns);
  expect(result.product.protein).toBe('3.5');
  expect(result.evidence.tables.map((table) => table.basis)).toEqual(['per100', 'serving']);
  expect(result.evidence.tables[1].servingQuantity.value).toBe('25');
});

it.each([missing, { value: '25', status: 'uncertain', note: 'Unreadable heading' }] as const)(
  'withholds nutrients when the physical heading is not reliably known',
  async (referenceQuantity) => {
    const { normalizeColumnExtraction } = await import('./normalize');
    const { milkColumns } = await import('./fixtures');
    const columns = milkColumns();
    columns.tables[0].referenceQuantity = referenceQuantity;
    expect(normalizeColumnExtraction(columns).product).not.toHaveProperty('protein');
  }
);

it('does not accept obsolete basis classifications in the new inference contract', async () => {
  const { normalizeColumnExtraction } = await import('./normalize');
  expect(() => normalizeColumnExtraction(dutchMilk())).toThrow();
  // Previously persisted evidence continues to load and normalize through its stable schema.
  expect(normalizeExtraction(dutchMilk()).product.protein).toBe('3.5');
});

it.each(['%', 'G'] as const)(
  'retains literal RI headings as percentage evidence, without poisoning physical columns (unit %s)',
  async (unit) => {
    const { normalizeColumnExtraction } = await import('./normalize');
    const { milkColumns } = await import('./fixtures');
    const columns = milkColumns();
    const percent = {
      referenceQuantity: printed('RI*'),
      unit,
      note: '',
      values: { ...columns.tables[0].values, protein: { unit: 'g', ...printed('12') } },
    };
    const result = normalizeColumnExtraction({ ...columns, tables: [...columns.tables, percent] });
    expect(result.product.protein).toBe('3.5');
    expect(result.evidence.tables[1]).toMatchObject({
      basis: 'referenceIntake',
      unit: null,
      values: expect.arrayContaining([
        expect.objectContaining({ nutrient: 'protein', unit: '%', value: '12' }),
      ]),
    });
  }
);

it('does not treat an unknown physical column as RI just because its amount contradicts another column', async () => {
  const { normalizeColumnExtraction } = await import('./normalize');
  const { milkColumns } = await import('./fixtures');
  const columns = milkColumns();
  columns.tables.push({
    ...columns.tables[0],
    referenceQuantity: missing,
    values: { ...columns.tables[0].values, protein: { unit: 'g', ...printed('12') } },
  });
  const result = normalizeColumnExtraction(columns);
  expect(result.product.protein).toBe('3.5');
  expect(result.evidence.tables[1].basis).toBe('unknown');
  expect(
    result.evidence.tables[1].values.find((field) => field.nutrient === 'protein')?.value
  ).toBe('12');
  expect(result.warnings).toContain(
    'Some nutrition columns have an unknown or unreadable physical reference; they were not converted.'
  );
});

it('parses literal physical column headings while preserving their observed reference', async () => {
  const { normalizeColumnExtraction } = await import('./normalize');
  const { milkColumns } = await import('./fixtures');
  const columns = milkColumns();
  columns.tables[0].referenceQuantity = printed('per 100 ml');
  const per25 = {
    ...columns.tables[0],
    referenceQuantity: printed('per 25 ml'),
    values: {
      ...columns.tables[0].values,
      energyKcal: missing,
      energyKj: missing,
      protein: { unit: 'g' as const, ...printed('0.9') },
      fat: { unit: 'g' as const, ...missing },
      carbohydrates: { unit: 'g' as const, ...missing },
      salt: { unit: 'g' as const, ...missing },
    },
  };
  const result = normalizeColumnExtraction({ ...columns, tables: [...columns.tables, per25] });
  expect(result.product.protein).toBe('3.5');
  expect(result.evidence.tables[1].servingQuantity).toMatchObject({
    value: '25',
    status: 'printed',
  });
  expect(result.evidence.tables[1].servingQuantity.note).toContain('per 25 ml');
});

it.each(['per 100 g', 'about 100 ml', '25 servings', '100 ml or 25 ml'])(
  'withholds contradictory or non-physical headings: %s',
  async (heading) => {
    const { normalizeColumnExtraction } = await import('./normalize');
    const { milkColumns } = await import('./fixtures');
    const columns = milkColumns();
    columns.tables[0].referenceQuantity = printed(heading);
    expect(normalizeColumnExtraction(columns).product).not.toHaveProperty('protein');
  }
);

it('rejects empty or incomplete inference tables instead of silently reporting extraction success', async () => {
  const { normalizeColumnExtraction } = await import('./normalize');
  const { milkColumns } = await import('./fixtures');
  expect(() => normalizeColumnExtraction({ ...milkColumns(), tables: [] })).toThrow();
  const columns = milkColumns();
  const { protein: _protein, ...incomplete } = columns.tables[0].values;
  expect(() =>
    normalizeColumnExtraction({
      ...columns,
      tables: [{ ...columns.tables[0], values: incomplete }],
    })
  ).toThrow();
});

it('keeps an independently readable per-100 column when a secondary portion has no usable size', () => {
  const data = dutchMilk();
  data.tables.push({
    basis: 'unknown',
    unit: 'ML',
    servingQuantity: printed('glass'),
    note: 'per glass',
    values: [{ nutrient: 'protein', unit: 'g', ...printed('0.2') }],
  });
  const result = normalizeExtraction(data);
  expect(result.product.protein).toBe('3.5');
  expect(result.nutrition.protein.note).toContain('excluded');
  expect(result.warnings).toContain(
    'Some nutrition columns have an unknown or unreadable physical reference; they were not converted.'
  );
  // The secondary value is retained for review, never converted using an assumed size.
  expect(result.evidence.tables[1].servingQuantity.value).toBe('glass');
  expect(result.evidence.tables[1].values[0].value).toBe('0.2');
});

it('does not use the secondary-column exception to accept uncertain or conflicting per-100 observations', () => {
  const data = dutchMilk();
  data.tables.push({
    basis: 'unknown',
    unit: 'ML',
    servingQuantity: printed('glass'),
    note: '',
    values: [{ nutrient: 'protein', unit: 'g', ...printed('0.2') }],
  });
  data.tables[0].values.find((field) => field.nutrient === 'protein')!.status = 'uncertain';
  expect(normalizeExtraction(data).product).not.toHaveProperty('protein');
  data.tables[0].values.find((field) => field.nutrient === 'protein')!.status = 'printed';
  data.tables.push({
    ...data.tables[0],
    values: [{ nutrient: 'protein', unit: 'g', ...printed('10') }],
  });
  expect(normalizeExtraction(data).product).not.toHaveProperty('protein');
});

it('still withholds a serving-only conversion when another physical reference is unresolved', () => {
  const data = dutchMilk();
  data.tables[0].basis = 'serving';
  data.tables[0].servingQuantity = printed('100');
  data.tables.push({
    basis: 'unknown',
    unit: 'ML',
    servingQuantity: printed('glass'),
    note: '',
    values: [{ nutrient: 'protein', unit: 'g', ...printed('0.2') }],
  });
  expect(normalizeExtraction(data).product).not.toHaveProperty('protein');
});

it.each(['blokje (4,2 g)', 'per stukje (4.2 g)', 'portion (4,2 g)'])(
  'reads an explicit physical size from a named column heading: %s',
  async (heading) => {
    const { normalizeColumnExtraction } = await import('./normalize');
    const { milkColumns } = await import('./fixtures');
    const data = milkColumns();
    data.tables[0].unit = 'G';
    data.tables[0].referenceQuantity = printed(heading);
    data.tables[0].values.protein = { ...printed('0.21'), unit: 'g' };
    expect(normalizeColumnExtraction(data).product.protein).toBe('5');
  }
);

it('does not pull a named serving size out of arbitrary notes or conflicting units', async () => {
  const { normalizeColumnExtraction } = await import('./normalize');
  const { milkColumns } = await import('./fixtures');
  const data = milkColumns();
  data.tables[0].referenceQuantity = { ...printed('glass'), note: '25 ml per glass' };
  expect(normalizeColumnExtraction(data).product).not.toHaveProperty('protein');
  data.tables[0].referenceQuantity = printed('blokje (4.2 g)');
  // The fixture says ML, contradicting the literal heading's g.
  expect(normalizeColumnExtraction(data).product).not.toHaveProperty('protein');
});

it('allows a printed fractional piece weight to round without treating its energy as a contradiction', () => {
  const data = dutchMilk();
  data.tables = [
    {
      basis: 'per100',
      unit: 'G',
      servingQuantity: missing,
      note: 'per 100 g',
      values: [
        { nutrient: 'calories', unit: 'kJ', ...printed('2189') },
        { nutrient: 'calories', unit: 'kcal', ...printed('524') },
        { nutrient: 'protein', unit: 'g', ...printed('5.3') },
      ],
    },
    {
      basis: 'serving',
      unit: 'G',
      servingQuantity: printed('4.2'),
      note: 'piece',
      values: [
        { nutrient: 'calories', unit: 'kJ', ...printed('91') },
        { nutrient: 'calories', unit: 'kcal', ...printed('22') },
        { nutrient: 'protein', unit: 'g', ...printed('0.2') },
      ],
    },
  ];
  expect(normalizeExtraction(data).product).toMatchObject({ calories: '524', protein: '5.3' });
  data.tables[1].servingQuantity.value = '4.200';
  expect(normalizeExtraction(data).product).not.toHaveProperty('calories');
  data.tables[1].servingQuantity.value = '4.2';
  data.tables[1].values[1].value = '40';
  expect(normalizeExtraction(data).product).not.toHaveProperty('calories');
});

it('preserves trailing zero precision in a named serving heading', async () => {
  const { normalizeColumnExtraction } = await import('./normalize');
  const { milkColumns } = await import('./fixtures');
  const data = milkColumns();
  data.tables[0].unit = 'G';
  data.tables[0].referenceQuantity = printed('piece (4,20 g)');
  expect(normalizeColumnExtraction(data).evidence.tables[0].servingQuantity.value).toBe('4.20');
});
