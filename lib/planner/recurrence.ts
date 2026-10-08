const DAY_MS = 86_400_000;
const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

type ParsedRule = {
  freq: Frequency;
  interval: number;
  byDay: number[] | null;
};

function parseRule(rule: string): ParsedRule | null {
  const parts = new Map(
    rule
      .replace(/^RRULE:/, '')
      .split(';')
      .map((part) => part.split('=') as [string, string])
  );
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    return null;
  }
  const interval = Math.max(1, Number.parseInt(parts.get('INTERVAL') ?? '1', 10) || 1);
  const byDayRaw = parts.get('BYDAY');
  const byDay = byDayRaw
    ? byDayRaw.split(',').flatMap((code) => {
        const index = WEEKDAY_CODES.indexOf(code);
        return index >= 0 ? [index] : [];
      })
    : null;
  return { freq, interval, byDay };
}

// Supports FREQ/INTERVAL/BYDAY; dates are UTC-midnight calendar dates.
export function recurrenceMatchesDate(rule: string, start: Date, date: Date): boolean {
  const parsed = parseRule(rule);
  if (!parsed || date.getTime() < start.getTime()) {
    return false;
  }
  const { freq, interval, byDay } = parsed;
  const days = Math.round((date.getTime() - start.getTime()) / DAY_MS);

  if (freq === 'DAILY') {
    return days % interval === 0;
  }
  if (freq === 'WEEKLY') {
    const weekdays = byDay ?? [start.getUTCDay()];
    const startOfWeek = days - ((date.getUTCDay() - start.getUTCDay() + 7) % 7);
    return weekdays.includes(date.getUTCDay()) && Math.floor(startOfWeek / 7) % interval === 0;
  }
  const months =
    (date.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    date.getUTCMonth() -
    start.getUTCMonth();
  if (freq === 'MONTHLY') {
    return months % interval === 0 && date.getUTCDate() === start.getUTCDate();
  }
  return (
    months % (12 * interval) === 0 &&
    date.getUTCMonth() === start.getUTCMonth() &&
    date.getUTCDate() === start.getUTCDate()
  );
}
