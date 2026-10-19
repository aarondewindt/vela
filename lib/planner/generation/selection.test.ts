import { z } from 'zod';
import { selectionContract } from './selection';

const candidates = [
  { key: 'task-uuid:occurrence-one' },
  { key: 'task-uuid:occurrence-two' },
  { key: 'another-task:new' },
];
const response = {
  summary: 'A small day',
  workBudgetMinutes: 30,
  selected: [{ key: 'C2', reason: 'Due today' }],
  omitted: [],
};

it('constrains model references to short aliases for the current candidate pool', () => {
  const contract = selectionContract(candidates);
  const schema = z.toJSONSchema(contract.schema) as any;
  expect(schema.properties.selected.items.properties.key.enum).toEqual(['C1', 'C2', 'C3']);
  expect(contract.schema.safeParse(response).success).toBe(true);
  expect(
    contract.schema.safeParse({ ...response, selected: [{ key: 'C4', reason: 'Foreign' }] }).success
  ).toBe(false);
});

it('maps the exact chosen occurrence and leaves unmentioned candidates unscheduled with an honest explanation', () => {
  const result = selectionContract(candidates).resolve(response);
  expect(result.selection.selected).toEqual([{ key: candidates[1].key, reason: 'Due today' }]);
  expect(result.selection.omitted.map((item) => item.key)).toEqual([
    candidates[0].key,
    candidates[2].key,
  ]);
  expect(result.selection.omitted.every((item) => /did not select/.test(item.reason))).toBe(true);
  expect(result.warnings).toEqual([expect.stringContaining('2 candidates unassessed')]);
});

it('retains explicit omission reasons without warning when the model assessed every candidate', () => {
  const result = selectionContract(candidates).resolve({
    ...response,
    omitted: [
      { key: 'C1', reason: 'Later deadline' },
      { key: 'C3', reason: 'Keep today light' },
    ],
  });
  expect(result.selection.omitted).toEqual([
    { key: candidates[0].key, reason: 'Later deadline' },
    { key: candidates[2].key, reason: 'Keep today light' },
  ]);
  expect(result.warnings).toEqual([]);
});

it.each(['C4', 'c2', candidates[1].key, 'Due today'])(
  'rejects unknown or malformed reference %s without guessing a task',
  (key) => {
    expect(() =>
      selectionContract(candidates).resolve({
        ...response,
        selected: [{ key, reason: 'Wrong reference' }],
      })
    ).toThrow(/unknown candidate/);
  }
);

it.each([
  { ...response, selected: [response.selected[0], response.selected[0]] },
  { ...response, omitted: [{ key: 'C2', reason: 'Contradiction' }] },
])('rejects repeated or contradictory assessments', (raw) => {
  expect(() => selectionContract(candidates).resolve(raw)).toThrow(/more than once/);
});

it('does not select any work implicitly when the model chooses none', () => {
  const result = selectionContract(candidates).resolve({ ...response, selected: [] });
  expect(result.selection.selected).toEqual([]);
  expect(result.selection.omitted).toHaveLength(3);
});

it('requires an empty omission list for unguided fill ordering', () => {
  const contract = selectionContract(candidates, true);
  expect(contract.schema.safeParse(response).success).toBe(true);
  expect(
    contract.schema.safeParse({ ...response, omitted: [{ key: 'C1', reason: 'Less urgent' }] })
      .success
  ).toBe(false);
});
