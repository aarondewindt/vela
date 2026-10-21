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

it('validates optional calendar anchors without breaking existing recurrence callers', () => {
  const recurrence = { isRecurring: true, recurrenceRule: 'FREQ=DAILY', recurrenceTz: null };
  expect(taskRecurrenceSchema.parse(recurrence)).not.toHaveProperty('recurrenceAnchorDate');
  expect(
    taskRecurrenceSchema.parse({ ...recurrence, recurrenceAnchorDate: null }).recurrenceAnchorDate
  ).toBeNull();
  expect(
    taskRecurrenceSchema.safeParse({ ...recurrence, recurrenceAnchorDate: '2026-02-29' }).success
  ).toBe(false);
  expect(
    taskRecurrenceSchema.safeParse({ ...recurrence, recurrenceAnchorDate: '2028-02-29' }).success
  ).toBe(true);
});
