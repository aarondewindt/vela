import { z } from 'zod';
import { AiError } from '@/lib/ai/errors';
import { selectionSchema, type Selection } from './schema';

/** Short request-local references keep model output separate from database identities. */
export function selectionContract(candidates: readonly { key: string }[], fill = false) {
  if (!candidates.length) {
    throw new Error('Selection requires at least one candidate.');
  }
  const references = candidates.map((candidate, index) => ({
    key: `C${index + 1}`,
    originalKey: candidate.key,
  }));
  const key = z.enum(references.map((reference) => reference.key) as [string, ...string[]]);
  const assessment = z.object({ key, reason: z.string().trim().min(1).max(700) }).strict();
  const schema = selectionSchema.extend({
    selected: z.array(assessment).max(candidates.length),
    omitted: z.array(assessment).max(fill ? 0 : candidates.length),
  });
  return {
    references,
    schema,
    resolve(raw: unknown): { selection: Selection; warnings: string[]; unassessedCount: number } {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        throw new AiError(
          'INVALID_PROVIDER_RESPONSE',
          'The model returned an invalid task selection or an unknown candidate reference.'
        );
      }
      const seen = new Set<string>();
      const resolveItems = (items: Selection['selected']) =>
        items.map((item) => {
          if (seen.has(item.key)) {
            throw new AiError(
              'INVALID_PROVIDER_RESPONSE',
              'The model assessed the same candidate more than once.'
            );
          }
          seen.add(item.key);
          return {
            ...item,
            key: references.find((reference) => reference.key === item.key)!.originalKey,
          };
        });
      const selected = resolveItems(parsed.data.selected);
      const omitted = resolveItems(parsed.data.omitted);
      const unmentioned = references.filter((reference) => !seen.has(reference.key));
      omitted.push(
        ...unmentioned.map((reference) => ({
          key: reference.originalKey,
          reason:
            'The AI did not select this task or supply an omission reason. It remains unscheduled.',
        }))
      );
      return {
        unassessedCount: unmentioned.length,
        selection: { ...parsed.data, selected, omitted },
        warnings: unmentioned.length
          ? [
              `The AI left ${unmentioned.length} candidates unassessed. They remain unscheduled; review their remaining work and deadline risks below.`,
            ]
          : [],
      };
    },
  };
}
