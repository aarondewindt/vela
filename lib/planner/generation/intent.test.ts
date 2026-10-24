import { fixture, at } from './fixtures';
import { planningCandidates } from './candidates';
import { placementIntent } from './intent';
import { scheduleDay } from './schedule';
import { validateProposal } from '../proposals/validate';

it('fills after the AI shortlist without accepting an unrequested model-imposed work cap', () => {
  const s = fixture([60, 45, 30]);
  const candidates = planningCandidates(s).candidates;
  const intent = placementIntent(
    candidates,
    {
      summary: 'Shortlist',
      workBudgetMinutes: 30,
      selected: [{ key: candidates[1].key, reason: 'Preferred' }],
      omitted: [],
    },
    ''
  );
  expect(intent.goal).toBe('fill');
  expect(intent.workBudgetMinutes).toBeNull();
  expect(intent.ordered.map((item) => item.candidate.key)).toEqual([
    candidates[1].key,
    candidates[0].key,
    candidates[2].key,
  ]);
  const result = scheduleDay(s, intent.ordered, intent.workBudgetMinutes, at('00:00'));
  expect([...result.scheduled.values()].reduce((n, m) => n + m, 0)).toBe(135);
  expect(() => validateProposal(s, result.document, at('00:00'))).not.toThrow();
});

it('keeps a guided focus and a light-day cap instead of adding omitted tasks', () => {
  const candidates = planningCandidates(fixture([60, 45])).candidates;
  const selection = {
    summary: 'Housework only',
    workBudgetMinutes: 30,
    selected: [{ key: candidates[0].key, reason: 'Focus' }],
    omitted: [{ key: candidates[1].key, reason: 'Different focus' }],
  };
  const intent = placementIntent(candidates, selection, 'Keep today light and focus on housework');
  expect(intent.goal).toBe('guided');
  expect(intent.workBudgetMinutes).toBe(30);
  expect(intent.additionalKeys.size).toBe(0);
  expect(intent.ordered).toHaveLength(1);
});

it('respects an explicit guided zero-work budget', () => {
  const candidates = planningCandidates(fixture([60])).candidates;
  const intent = placementIntent(
    candidates,
    { summary: 'Rest day', workBudgetMinutes: 0, selected: [], omitted: [] },
    'No work today'
  );
  expect(intent.workBudgetMinutes).toBe(0);
  expect(intent.ordered).toEqual([]);
});

it('tries eligible work when an unguided model returns an empty shortlist', () => {
  const candidates = planningCandidates(fixture([60])).candidates;
  expect(
    placementIntent(
      candidates,
      { summary: 'Nothing urgent', workBudgetMinutes: 0, selected: [], omitted: [] },
      '  '
    ).ordered.map((item) => item.candidate)
  ).toEqual(candidates);
});

it('fills standard weekday availability around leisure rather than stopping after a small shortlist', () => {
  const s = fixture(Array(18).fill(60));
  s.settings.leisureMinutes = 60;
  s.windows = [
    { startMinute: 480, endMinute: 525 },
    { startMinute: 720, endMinute: 780 },
    { startMinute: 1035, endMinute: 1440 },
  ] as typeof s.windows;
  const candidates = planningCandidates(s).candidates;
  const selection = {
    summary: 'Just a few',
    workBudgetMinutes: 105,
    selected: [{ key: candidates[0].key, reason: 'Preferred' }],
    omitted: [],
  };
  const intent = placementIntent(candidates, selection, '');
  const result = scheduleDay(s, intent.ordered, intent.workBudgetMinutes, at('00:00'));
  const minutes = [...result.scheduled.values()].reduce((n, m) => n + m, 0);
  expect(minutes).toBeGreaterThan(330);
  expect(minutes).toBeLessThanOrEqual(450); // 510 available minutes less reserved leisure.
  expect(() => validateProposal(s, result.document, at('00:00'))).not.toThrow();
});

it('allocates approximate per-task durations within the existing scheduler without changing estimates', () => {
  const s = fixture([240, 120, 240, 60]);
  const candidates = planningCandidates(s).candidates;
  const before = s.tasks.map((task) => task.estimatedMinutes);
  const intent = placementIntent(
    candidates,
    {
      summary: 'Vela, cleaning, a little guitar and mostly video',
      workBudgetMinutes: null,
      selected: candidates.map((candidate, index) => ({
        key: candidate.key,
        reason: 'Requested',
        plannedMinutes: [60, 30, 120, 15][index],
      })),
      omitted: [],
    },
    'About an hour Vela; max half an hour cleaning; mostly video; some guitar'
  );
  const result = scheduleDay(s, intent.ordered, intent.workBudgetMinutes, at('00:00'));
  expect([...result.scheduled.values()]).toEqual([60, 30, 120, 15]);
  expect(s.tasks.map((task) => task.estimatedMinutes)).toEqual(before);
  expect(() => validateProposal(s, result.document, at('00:00'))).not.toThrow();
});
it('does not let unsolicited per-task model targets shrink an unguided fill plan', () => {
  const s = fixture([60]);
  const candidates = planningCandidates(s).candidates;
  const intent = placementIntent(
    candidates,
    {
      summary: 'Small',
      workBudgetMinutes: null,
      selected: [{ key: candidates[0].key, reason: 'Pick', plannedMinutes: 15 }],
      omitted: [],
    },
    ''
  );
  expect(scheduleDay(s, intent.ordered, null, at('00:00')).scheduled.get(candidates[0].key)).toBe(
    60
  );
});
