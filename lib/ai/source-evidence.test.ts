/** @jest-environment node */
import {
  indexSourceEvidence,
  sourceEvidenceSchema,
  sourceNumbers,
  validatePhotographSources,
  assignSourceIdentifiers,
} from './source-evidence';
import { milkSource, milkTranscription } from '../nutrition/product-extraction/pipeline-fixtures';

it('assigns stable source IDs without asking the model to generate table references', () => {
  const transcription = milkTranscription();
  const source = assignSourceIdentifiers(transcription, ['front', 'back']);
  expect(source.photographs[1].tables[0].rows[0].cells[0]).toMatchObject({
    text: '195 kJ / 47 kcal',
    columnId: 'source:1:table:0:column:0',
  });
  expect(
    assignSourceIdentifiers(
      { ...transcription, photographs: [...transcription.photographs].reverse() },
      ['front', 'back']
    )
  ).toEqual(source);
  const missing = milkTranscription();
  missing.photographs[1].tables[0].rows[0].cells.pop();
  expect(() => assignSourceIdentifiers(missing, ['front', 'back'])).toThrow('one cell slot');
  const duplicate = milkTranscription();
  duplicate.photographs[1].id = 'front';
  expect(() => assignSourceIdentifiers(duplicate, ['front', 'back'])).toThrow('exactly once');
  duplicate.photographs[1].id = 'foreign';
  expect(() => assignSourceIdentifiers(duplicate, ['front', 'back'])).toThrow();
});

it('preserves arbitrary rows, original text, uncertainty and stable photograph provenance', () => {
  const source = sourceEvidenceSchema.parse(milkSource());
  expect(indexSourceEvidence(source).get('back-cell-1-0')).toMatchObject({
    text: '1,5 g',
    rowId: 'back-row-1',
    columnId: 'back-100',
    photographId: 'back',
  });
  expect(validatePhotographSources(source, ['front', 'back', 'front'])).toBe(source);
  expect(() => validatePhotographSources(source, ['other'])).toThrow('photograph identifier');
});
it('rejects duplicate identifiers and references across table boundaries', () => {
  const duplicate = milkSource();
  duplicate.photographs[0].text[0].id = 'back-cell-1-0';
  expect(sourceEvidenceSchema.safeParse(duplicate).success).toBe(false);
  const invalidColumn = milkSource();
  invalidColumn.photographs[1].tables[0].rows[0].cells[0].columnId = 'nonexistent';
  expect(sourceEvidenceSchema.safeParse(invalidColumn).success).toBe(false);
  invalidColumn.photographs[1].tables[0].rows[0].cells[0].columnId = 'back-serving';
  expect(sourceEvidenceSchema.safeParse(invalidColumn).success).toBe(false);
});
it('indexes printed tokens without normalizing, repairing or dropping censoring and precision', () => {
  expect(sourceNumbers('2192 kJ / 524 kcal; <0,50 g; 5.80; 1.234,5; -2')).toEqual([
    '2192',
    '524',
    '<0,50',
    '5.80',
    '1.234,5',
    '-2',
  ]);
  expect(sourceNumbers('1 234 kJ; < 0,50 grams')).toEqual(['1 234', '< 0,50']);
});
