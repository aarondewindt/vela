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

export function toDateInput(date: Date | string | null | undefined) {
  return date ? new Date(date).toISOString().slice(0, 10) : '';
}
