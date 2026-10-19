// Resolve saved-zone wall times without relying on the server/browser timezone.
export function wallInstant(date: string, minute: number, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day, 0, minute);
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const represented = (instant: number) => {
    const p = Object.fromEntries(
      format.formatToParts(new Date(instant)).map(({ type, value }) => [type, value])
    );
    return Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute)
    );
  };
  const matches = new Set<number>();
  for (let hour = -36; hour <= 36; hour += 6) {
    const sample = target + hour * 3_600_000;
    const candidate = target - (represented(sample) - sample);
    if (represented(candidate) === target) {
      matches.add(candidate);
    }
  }
  if (matches.size !== 1) {
    throw new Error(
      matches.size
        ? 'This time occurs twice in the saved timezone. Use an explicit UTC offset through the proposal API.'
        : 'This time does not exist in the saved timezone.'
    );
  }
  return new Date([...matches][0]);
}

export function timeMinute(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  if (hour > 23 || minute > 59) {
    throw new Error('Enter a valid time.');
  }
  return hour * 60 + minute;
}
