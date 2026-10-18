import { z } from 'zod';

export const diaryDateSchema = z.iso
  .date()
  .refine((value) => value >= '0001-01-01', 'Choose a calendar date between years 1 and 9999.');

export function dateInTimezone(timezone: string, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map(({ type, value }) => [type, value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function diaryDate(value: string) {
  return new Date(`${diaryDateSchema.parse(value)}T00:00:00.000Z`);
}

export function shiftDiaryDate(value: string, days: number) {
  const date = diaryDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return diaryDateSchema.parse(date.toISOString().slice(0, 10));
}

export function formatDiaryDate(value: string) {
  // Match the app's English labels on both server and client during hydration.
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(diaryDate(value));
}
