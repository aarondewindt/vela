import { TRPCError } from '@trpc/server';

export class Clarification extends Error {
  constructor(
    message: string,
    readonly matches: { id: string; label: string }[] = []
  ) {
    super(message);
  }
}

export function findMatches<T extends { id: string; label: string }>(records: T[], query: string) {
  const q = query.trim().toLocaleLowerCase();
  const exact = records.filter((r) => r.id === query || r.label.toLocaleLowerCase() === q);
  return exact.length ? exact : records.filter((r) => r.label.toLocaleLowerCase().includes(q));
}

export function resolveOne<T extends { id: string; label: string }>(
  records: T[],
  query: string | null,
  kind: string
): T {
  if (!query) {
    throw new Clarification(`Which ${kind} do you mean?`, records.slice(0, 12));
  }
  const matches = findMatches(records, query);
  if (matches.length !== 1) {
    throw new Clarification(
      matches.length
        ? `Several ${kind}s match “${query}”. Choose one by its ID.`
        : `No ${kind} matches “${query}”. Give its name or ID.`,
      matches.slice(0, 12)
    );
  }
  return matches[0];
}

export const conflict = (
  message = 'The preview is stale. Send a new message and review the updated changes.'
) => new TRPCError({ code: 'CONFLICT', message });

/** Resolve unambiguous relative deadline phrases against the authoritative local date. */
export function relativeDueDate(text: string, today: string, title?: string): string | undefined {
  // Quoted task titles are data, even if they happen to contain a deadline phrase.
  let unquoted = text.replace(/"[^"\n]*"|'[^'\n]*'|“[^”\n]*”/g, '');
  if (title) {
    const at = unquoted.toLocaleLowerCase().indexOf(title.toLocaleLowerCase());
    if (at >= 0) {
      unquoted = unquoted.slice(0, at) + unquoted.slice(at + title.length);
    }
  }
  const matches = [...unquoted.matchAll(/\bdue\s+(?:(?:on|by)\s+)?(today|tomorrow|yesterday)\b/gi)];
  if (matches.length !== 1) {
    return undefined;
  }
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(
    date.getUTCDate() + ({ today: 0, tomorrow: 1, yesterday: -1 }[matches[0][1].toLowerCase()] ?? 0)
  );
  return date.toISOString().slice(0, 10);
}
