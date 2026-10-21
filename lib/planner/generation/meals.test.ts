/** @jest-environment node */
import { DEFAULT_MEAL_PREFERENCES, mealPreferencesSchema } from '../meals';
import { fixture, at, taskId } from './fixtures';
import type { Snapshot } from '../proposals/snapshot';
import { scheduleDay } from './schedule';
import { planningCandidates } from './candidates';
import { documentSchema, type ProposalDocument } from '../proposals/schema';
import { validateProposal } from '../proposals/validate';
import { replanDay } from '../proposals/replan';

function withMeals(durations: number[] = []) {
  const s = fixture(durations);
  s.windows = [{ startMinute: 420, endMinute: 1260 }] as Snapshot['windows'];
  s.settings = {
    ...s.settings,
    mealPreferences: structuredClone(DEFAULT_MEAL_PREFERENCES),
  } as Snapshot['settings'];
  const preferences = s.settings.mealPreferences as typeof DEFAULT_MEAL_PREFERENCES;
  Object.values(preferences).forEach((p) => {
    p.enabled = true;
  });
  return { s, preferences };
}
const run = (s: Snapshot) =>
  scheduleDay(
    s,
    planningCandidates(s).candidates.map((candidate) => ({ candidate, reason: 'Test' })),
    null,
    at('00:00')
  );
function apply(s: Snapshot, document: ProposalDocument) {
  const result = validateProposal(s, document, at('00:00'));
  s.plan = {
    id: taskId(90),
    categorySlots: document.reservations ?? [],
  } as unknown as Snapshot['plan'];
  s.blocks = result.final.map((b, i) => ({
    ...b,
    id: b.id.startsWith('new:') ? taskId(100 + i) : b.id,
    userId: s.userId,
    planId: s.plan!.id,
    taskOccurrenceId: b.occurrenceId,
  })) as unknown as Snapshot['blocks'];
}
const replan = (s: Snapshot, pullForward = false) =>
  replanDay(
    s,
    {
      requestId: taskId(99),
      date: s.date,
      baseHash: s.hash,
      action: 'replan',
      pullForward,
      completeTask: false,
      explanation: 'Changed day',
    },
    'hash',
    at('00:00')
  );

it('reserves all meals before optional work/leisure and validates the complete overloaded day', () => {
  const { s } = withMeals([900, 900]);
  s.settings.leisureMinutes = 60;
  const before = JSON.stringify(s);
  const result = run(s);
  expect(result.meals.map((m) => m.status)).toEqual(['scheduled', 'scheduled', 'scheduled']);
  const document = documentSchema.parse(result.document);
  const validated = validateProposal(s, document, at('00:00'));
  expect(validated.final.filter((b) => b.mealKind).map((b) => b.durationMinutes)).toEqual([
    30, 45, 60,
  ]);
  expect(
    validated.final.filter((b) => b.taskId).reduce((n, b) => n + b.durationMinutes, 0)
  ).toBeLessThan(840 - 135 - 60);
  expect(JSON.stringify(s)).toBe(before);
});
it('does not require tasks, a model or category slots for meal placement', () => {
  const { s } = withMeals();
  expect(run(s).document.operations).toHaveLength(3);
  expect(s.tasks).toHaveLength(0);
});
it('does not create requirements for existing accounts until enabled', () => {
  expect(run(fixture([])).meals).toEqual([]);
});
it('allows disabled individual meals and handles overlapping preferred windows without overlap', () => {
  const { s, preferences } = withMeals();
  preferences.BREAKFAST.enabled = false;
  preferences.DINNER = { ...preferences.LUNCH };
  const result = run(s);
  expect(result.meals.map((m) => m.status)).toEqual(['scheduled', 'scheduled']);
  const final = validateProposal(s, result.document, at('00:00')).final;
  expect(final[1].startsAt >= final[0].endsAt).toBe(true);
});
it.each(['PTO', 'NO_WORK', 'CUSTOM'])('reports every unmet meal for %s days', (mode) => {
  const { s } = withMeals();
  s.override = { workMode: mode, availabilityWindows: [] } as unknown as Snapshot['override'];
  const result = run(s);
  expect(result.meals.every((m) => m.status === 'unmet')).toBe(true);
  expect(result.warnings).toHaveLength(3);
  expect(result.document.operations).toEqual([]);
});
it('does not split meals across fragmented availability or silently fall outside a preferred window', () => {
  const { s } = withMeals();
  s.windows = [
    { startMinute: 420, endMinute: 435 },
    { startMinute: 450, endMinute: 465 },
  ] as Snapshot['windows'];
  expect(run(s).meals.map((m) => m.status)).toEqual(['unmet', 'unmet', 'unmet']);
});
it('honors calendar commitments, half-open boundaries and same-day review cutoff', () => {
  const { s } = withMeals();
  s.events = [
    { id: taskId(70), isBusy: true, startsAt: at('07:00'), endsAt: at('08:00') },
  ] as Snapshot['events'];
  const result = scheduleDay(s, [], null, at('07:30'));
  expect(result.document.operations[0]).toMatchObject({
    block: { startsAt: at('08:00').toISOString() },
  });
  expect(scheduleDay(s, [], null, at('20:00')).meals.every((m) => m.status === 'unmet')).toBe(true);
});
it('preserves existing meal identities and edited duration across generation and repeated replanning', () => {
  const { s } = withMeals();
  apply(s, run(s).document);
  const breakfast = s.blocks.find((b) => b.mealKind === 'BREAKFAST')!;
  const edit: ProposalDocument = {
    schemaVersion: 1,
    operations: [
      {
        type: 'resize',
        blockId: breakfast.id,
        startsAt: breakfast.startsAt.toISOString(),
        endsAt: at('07:40').toISOString(),
        explicit: true,
        explanation: 'Longer breakfast',
      },
    ],
  };
  const adjusted = validateProposal(s, edit, at('00:00')).final.find((b) => b.id === breakfast.id)!;
  expect(adjusted.isFixed).toBe(true);
  Object.assign(breakfast, adjusted);
  const before = JSON.stringify(s.blocks);
  expect(run(s).document.operations).toEqual([]);
  expect(replan(s).operations).toEqual([]);
  expect(
    replan(s, true).operations.some((op) => op.type !== 'add' && op.blockId === breakfast.id)
  ).toBe(false);
  expect(JSON.stringify(s.blocks)).toBe(before);
});
it.each(['DONE', 'SKIPPED', 'CANCELED'] as const)('does not recreate %s meal history', (status) => {
  const { s } = withMeals();
  apply(s, run(s).document);
  s.blocks[0].status = status;
  const result = run(s);
  expect(result.document.operations).toEqual([]);
  expect(result.meals[0].status).toBe(status === 'DONE' ? 'preserved' : 'skipped');
});
it('rejects duplicate meals in a proposal, including replacement of a cancelled daily block', () => {
  const { s } = withMeals();
  const d = run(s).document;
  const duplicate = { ...d, operations: [d.operations[0], d.operations[0]] };
  expect(() => validateProposal(s, duplicate, at('00:00'))).toThrow(/one block per meal/);
  apply(s, d);
  s.blocks[0].status = 'CANCELED';
  expect(() =>
    validateProposal(s, { schemaVersion: 1, operations: [d.operations[0]] }, at('00:00'))
  ).toThrow(/one block per meal|already has a block/);
});
it('rejects invented or disabled meal identities at the application boundary', () => {
  const { s, preferences } = withMeals();
  const d = run(s).document;
  preferences.BREAKFAST.enabled = false;
  expect(() => validateProposal(s, { ...d, operations: [d.operations[0]] }, at('00:00'))).toThrow(
    /disabled/
  );
  expect(
    documentSchema.safeParse({
      schemaVersion: 1,
      operations: [
        {
          type: 'add',
          explanation: 'Invented',
          block: {
            kind: 'MEAL',
            mealKind: 'SNACK',
            startsAt: at('09:00').toISOString(),
            endsAt: at('09:30').toISOString(),
          },
        },
      ],
    }).success
  ).toBe(false);
});
it('adds missing requirements during replanning and moves a flexible meal around changed calendar data', () => {
  const { s } = withMeals();
  const first = replan(s);
  expect(first.operations).toHaveLength(3);
  apply(s, first);
  s.events = [
    { id: taskId(70), isBusy: true, startsAt: at('07:00'), endsAt: at('08:00') },
  ] as Snapshot['events'];
  expect(run(s).meals[0].status).toBe('unmet');
  const changed = replan(s);
  const final = validateProposal(s, changed, at('00:00')).final;
  expect(final.find((b) => b.mealKind === 'BREAKFAST')).toMatchObject({
    id: s.blocks[0].id,
    startsAt: at('08:00'),
  });
});
it('reports flexible meals that no longer fit while keeping fixed individual overrides for review', () => {
  const { s } = withMeals();
  apply(s, run(s).document);
  s.blocks[1].isFixed = true;
  s.windows = [];
  const d = replan(s);
  expect(d.replan!.warnings.join()).toMatch(/Breakfast requirement unmet/);
  expect(d.replan!.warnings.join()).toMatch(/Lunch.*conflicts/);
  expect(d.operations.some((op) => op.type === 'remove' && op.blockId === s.blocks[1].id)).toBe(
    false
  );
});
it('resolves meal windows in the saved plan timezone, including normal DST days', () => {
  const { s } = withMeals();
  s.timezone = 'Europe/Amsterdam';
  s.date = '2030-03-31';
  const result = scheduleDay(s, [], null, new Date('2030-03-30T00:00:00Z'));
  expect(result.document.operations[0]).toMatchObject({
    block: { startsAt: '2030-03-31T05:00:00.000Z' },
  });
});
it('reports DST-invalid windows instead of moving meals to another local time', () => {
  const { s, preferences } = withMeals();
  s.timezone = 'Europe/Amsterdam';
  s.date = '2030-03-31';
  preferences.BREAKFAST.startMinute = 150;
  preferences.BREAKFAST.endMinute = 210;
  expect(scheduleDay(s, [], null, new Date('2030-03-30T00:00:00Z')).meals[0]).toMatchObject({
    status: 'unmet',
    reason: expect.stringMatching(/cannot be resolved/),
  });
});
it('validates full-window durations and rejects unbounded/general routine configuration', () => {
  const preferences = structuredClone(DEFAULT_MEAL_PREFERENCES);
  preferences.LUNCH.endMinute = preferences.LUNCH.startMinute;
  expect(mealPreferencesSchema.safeParse(preferences).success).toBe(false);
  expect(mealPreferencesSchema.safeParse({ ...DEFAULT_MEAL_PREFERENCES, SLEEP: {} }).success).toBe(
    false
  );
});
