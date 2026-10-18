/** @jest-environment node */
import { dateInTimezone, diaryDate, diaryDateSchema, shiftDiaryDate } from './dates';

it('derives today from the saved timezone, independently of the host date', () => {
  const now = new Date('2026-10-17T22:30:00Z');
  expect(dateInTimezone('Europe/Amsterdam', now)).toBe('2026-10-18');
  expect(dateInTimezone('America/Los_Angeles', now)).toBe('2026-10-17');
});
it('keeps explicit diary dates stable across timezone and DST boundaries', () => {
  expect(diaryDate('2026-10-25').toISOString()).toBe('2026-10-25T00:00:00.000Z');
  expect(shiftDiaryDate('2026-10-25', 1)).toBe('2026-10-26');
  expect(shiftDiaryDate('2026-03-29', -1)).toBe('2026-03-28');
  expect(shiftDiaryDate('2026-12-31', 1)).toBe('2027-01-01');
});
it.each(['2026-02-29', '2026-10-17T23:00:00Z', '0000-01-01', '2026-13-01'])(
  'rejects invalid calendar date %s',
  (value) => {
    expect(diaryDateSchema.safeParse(value).success).toBe(false);
  }
);
