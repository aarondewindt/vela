import { recurrenceMatchesDate } from '../recurrence';

// Reject syntax the legacy subset silently ignores instead of inventing occurrences.
export function supportedRecurrence(rule: string | null) {
  if (!rule) {
    return false;
  }
  const parts = rule.replace(/^RRULE:/, '').split(';');
  const keys = parts.map((part) => part.split('=')[0]);
  const interval = parts.find((part) => part.startsWith('INTERVAL='))?.slice(9) ?? '1';
  return (
    Number.isSafeInteger(Number(interval)) &&
    (!keys.includes('BYDAY') || parts.includes('FREQ=WEEKLY')) &&
    new Set(keys).size === keys.length &&
    parts.every((part) =>
      /^(FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)|INTERVAL=[1-9]\d*|BYDAY=(SU|MO|TU|WE|TH|FR|SA)(,(SU|MO|TU|WE|TH|FR|SA))*)$/.test(
        part
      )
    ) &&
    keys.includes('FREQ')
  );
}

export function occursOn(task: { recurrenceRule: string | null; createdAt: Date }, date: string) {
  return (
    supportedRecurrence(task.recurrenceRule) &&
    recurrenceMatchesDate(
      task.recurrenceRule!,
      new Date(task.createdAt.toISOString().slice(0, 10)),
      new Date(`${date}T00:00:00Z`)
    )
  );
}
