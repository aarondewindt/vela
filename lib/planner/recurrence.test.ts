import { recurrenceStartDate } from './recurrence';
import { occursOn } from './proposals/recurrence';

const task = {
  createdAt: new Date('2026-01-01T23:59:00Z'),
  recurrenceRule: 'FREQ=DAILY;INTERVAL=3',
  recurrenceAnchorDate: null as Date | null,
};
it('preserves the UTC creation-date anchor for existing tasks', () => {
  expect(recurrenceStartDate(task)).toEqual(new Date('2026-01-01T00:00:00Z'));
  expect(occursOn(task, '2026-01-04')).toBe(true);
  expect(occursOn(task, '2026-01-05')).toBe(false);
});
it('uses an explicit anchor without changing creation time, including anchors before creation', () => {
  const shifted = { ...task, recurrenceAnchorDate: new Date('2026-01-02T00:00:00Z') };
  expect(occursOn(shifted, '2026-01-01')).toBe(false);
  expect(occursOn(shifted, '2026-01-02')).toBe(true);
  expect(occursOn(shifted, '2026-01-05')).toBe(true);
  expect(occursOn(shifted, '2026-01-04')).toBe(false);
  expect(shifted.createdAt).toEqual(task.createdAt);
  expect(occursOn({ ...task, recurrenceAnchorDate: new Date('2025-12-31') }, '2026-01-03')).toBe(
    true
  );
});
it.each([
  ['FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', '2026-01-05', '2026-01-07', true],
  ['FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', '2026-01-05', '2026-01-14', false],
  ['FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', '2026-01-05', '2026-01-19', true],
  ['FREQ=MONTHLY', '2026-01-31', '2026-02-28', false],
  ['FREQ=MONTHLY', '2026-01-31', '2026-03-31', true],
  ['FREQ=YEARLY', '2024-02-29', '2025-02-28', false],
  ['FREQ=YEARLY', '2024-02-29', '2028-02-29', true],
])('anchors %s at %s for %s', (recurrenceRule, anchor, date, expected) => {
  expect(occursOn({ ...task, recurrenceRule, recurrenceAnchorDate: new Date(anchor) }, date)).toBe(
    expected
  );
});
