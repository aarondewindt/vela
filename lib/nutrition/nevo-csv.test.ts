/** @jest-environment node */
import { parseNevoCsv } from './nevo-csv';
import { maxNevoFileBytes } from './nevo-schema';
import { nevoCsvFixture } from './nevo-test-fixtures';

it('uses English primary names, full Dutch aliases, synonyms and decimal commas', () => {
  const parsed = parseNevoCsv(
    nevoCsvFixture([{ dutchName: 'Een volledige Nederlandse productnaam '.repeat(3).trim() }])
  );
  expect(parsed.version).toBe('NEVO-Online 2025 9.0');
  expect(parsed.rows[0]).toMatchObject({
    code: '1',
    product: {
      name: 'Synthetic potatoes raw',
      aliases: ['Een volledige Nederlandse productnaam '.repeat(3).trim(), 'Aardappel fixture'],
      referenceQuantity: '100',
      referenceUnit: 'G',
      calories: '88',
      protein: '2',
      carbohydrates: '19',
      fat: '0',
      fiber: '1.8',
      verificationStatus: 'VERIFIED',
    },
  });
  expect(parsed.rows[0].original['FIBT (g)']).toBe('1,8');
  expect(parsed.rows[0].original['Engelse naam/Food name']).toBe('Synthetic potatoes raw');
});
it('preserves native volume references and distinguishes missing fiber from zero', () => {
  const rows = parseNevoCsv(
    nevoCsvFixture([
      { code: '1', quantity: 'per 100ml', fiber: '' },
      { code: '2', fiber: '0' },
    ])
  ).rows;
  expect(rows[0].product.referenceUnit).toBe('ML');
  expect(rows[0].product.fiber).toBeNull();
  expect(rows[1].product.fiber).toBe('0');
});
it('handles BOM, quoted pipes/newlines, escaped quotes, CRLF and optional descriptive columns', () => {
  const csv = nevoCsvFixture([
    { name: 'Synthetic "food" | cooked', notes: 'First line.\nSecond line.' },
  ]);
  const product = parseNevoCsv(`\uFEFF${csv}\r\n\r\n`).rows[0].product;
  expect(product.name).toBe('Synthetic "food" | cooked');
  expect(product.description).toContain('First line.\nSecond line.');
});
it.each([
  [{ name: '' }, 'English and Dutch'],
  [{ dutchName: '' }, 'English and Dutch'],
  [{ calories: '' }, 'ENERCC'],
  [{ protein: 'NaN' }, 'PROT'],
  [{ fat: '-1' }, 'FAT'],
  [{ carbohydrates: '1e3' }, 'CHO'],
  [{ fiber: '<0,1' }, 'FIBT'],
  [{ quantity: 'per portion' }, '100g or per 100ml'],
  [{ code: '1; DROP TABLE' }, 'positive integer'],
])('rejects invalid required food data without guessing values: %j', (row, message) => {
  expect(() => parseNevoCsv(nevoCsvFixture([row]))).toThrow(message);
});
it('rejects duplicate codes, mixed releases and malformed CSV atomically', () => {
  expect(() => parseNevoCsv(nevoCsvFixture([{ code: '01' }, { code: '1' }]))).toThrow(
    'duplicate NEVO-code'
  );
  expect(() =>
    parseNevoCsv(nevoCsvFixture([{}, { code: '2', version: 'NEVO-Online 2026 10.0' }]))
  ).toThrow('same NEVO release');
  expect(() => parseNevoCsv(nevoCsvFixture().slice(0, -1))).toThrow('invalid CSV quoting');
  expect(() => parseNevoCsv(`${nevoCsvFixture()}|extra`)).toThrow('expected 13 columns');
  expect(() => parseNevoCsv(nevoCsvFixture().replace('ENERCC (kcal)', 'Energy'))).toThrow(
    'Missing NEVO column'
  );
  expect(() => parseNevoCsv('"NEVO-code"|"NEVO-code"\n1|1')).toThrow('duplicate column');
});
it('bounds uploads, invalid encodings and field sizes before import', () => {
  expect(() => parseNevoCsv('x'.repeat(maxNevoFileBytes + 1))).toThrow('at most 5 MB');
  expect(() => parseNevoCsv(nevoCsvFixture().replace('Synthetic', '\ufffd'))).toThrow('UTF-8');
  expect(() => parseNevoCsv(nevoCsvFixture([{ notes: 'x'.repeat(8193) }]))).toThrow(
    'field or row is too large'
  );
});
