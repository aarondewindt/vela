import type { TaskRow } from '@/lib/planner/tasks';
import { supportedRecurrence } from '@/lib/planner/proposals/recurrence';

const UTC = 'UTC';

export function formatDate(date: Date | string | null | undefined) {
  if (!date) {
    return '—';
  }
  // @db.Date values are UTC midnight; format in UTC to avoid off-by-one days.
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: UTC }).format(
    new Date(date)
  );
}

export function formatDateTime(date: Date | string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(date)
  );
}

// A compact display of saved settings; scheduling stays in the planner service.
export function formatRecurrence(task: Pick<TaskRow, 'isRecurring' | 'recurrenceRule'>) {
  if (!task.isRecurring) {
    return '';
  }
  const rule = task.recurrenceRule;
  if (!supportedRecurrence(rule) || !rule) {
    return 'Custom recurrence';
  }
  const parts = new Map(
    rule
      .replace(/^RRULE:/, '')
      .split(';')
      .map((part) => part.split('=') as [string, string])
  );
  const frequency = parts.get('FREQ')!;
  const interval = Number(parts.get('INTERVAL') ?? 1);
  const units: Record<string, string> = {
    DAILY: 'day',
    WEEKLY: 'week',
    MONTHLY: 'month',
    YEARLY: 'year',
  };
  const single: Record<string, string> = {
    DAILY: 'Daily',
    WEEKLY: 'Weekly',
    MONTHLY: 'Monthly',
    YEARLY: 'Yearly',
  };
  const weekdays: Record<string, string> = {
    MO: 'Mon',
    TU: 'Tue',
    WE: 'Wed',
    TH: 'Thu',
    FR: 'Fri',
    SA: 'Sat',
    SU: 'Sun',
  };
  const days =
    frequency === 'WEEKLY'
      ? parts
          .get('BYDAY')
          ?.split(',')
          .map((day) => weekdays[day])
          .join(', ')
      : null;
  const cadence = interval === 1 ? single[frequency] : `Every ${interval} ${units[frequency]}s`;
  return `${cadence}${days ? ` · ${days}` : ''}`;
}
