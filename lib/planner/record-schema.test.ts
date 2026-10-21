import { taskPatchSchema, taskRecurrenceSchema } from './record-schema';

it.each([
  'FREQ=DAILY',
  'RRULE:FREQ=DAILY;INTERVAL=2',
  'FREQ=WEEKLY;BYDAY=MO,WE,FR',
  'FREQ=MONTHLY',
  'FREQ=YEARLY',
])('accepts the supported recurrence subset: %s', (recurrenceRule) => {
  expect(
    taskRecurrenceSchema.safeParse({
      isRecurring: true,
      recurrenceRule,
      recurrenceTz: 'Europe/Amsterdam',
    }).success
  ).toBe(true);
});
it.each([
  null,
  '',
  'FREQ=HOURLY',
  'FREQ=DAILY;COUNT=2',
  'FREQ=DAILY;BYDAY=MO',
  'FREQ=DAILY;INTERVAL=0',
  'FREQ=DAILY;FREQ=WEEKLY',
])('rejects enabled unsupported recurrence: %s', (recurrenceRule) => {
  expect(
    taskRecurrenceSchema.safeParse({ isRecurring: true, recurrenceRule, recurrenceTz: null })
      .success
  ).toBe(false);
});
it('allows disabling a legacy rule without erasing it, but rejects invalid timezone metadata', () => {
  expect(
    taskPatchSchema.parse({
      recurrence: { isRecurring: false, recurrenceRule: 'FREQ=DAILY;COUNT=2', recurrenceTz: null },
    }).recurrence?.isRecurring
  ).toBe(false);
  expect(
    taskRecurrenceSchema.safeParse({
      isRecurring: true,
      recurrenceRule: 'FREQ=DAILY',
      recurrenceTz: 'Invalid/Zone',
    }).success
  ).toBe(false);
});
