/** @jest-environment node */
import { formatRecurrence } from './format';

it.each([
  ['FREQ=DAILY', 'Daily'],
  ['FREQ=DAILY;INTERVAL=2', 'Every 2 days'],
  ['FREQ=WEEKLY;BYDAY=MO,WE,FR', 'Weekly · Mon, Wed, Fri'],
  ['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH', 'Every 2 weeks · Tue, Thu'],
  ['FREQ=MONTHLY', 'Monthly'],
  ['FREQ=YEARLY;INTERVAL=3', 'Every 3 years'],
  ['FREQ=DAILY;COUNT=2', 'Custom recurrence'],
  [null, 'Custom recurrence'],
])('summarizes %s without changing its scheduling semantics', (recurrenceRule, expected) => {
  expect(formatRecurrence({ isRecurring: true, recurrenceRule })).toBe(expected);
});
it('leaves non-recurring tasks blank even when a rule is saved', () => {
  expect(formatRecurrence({ isRecurring: false, recurrenceRule: 'FREQ=DAILY' })).toBe('');
});
