import type { Candidate } from './candidates';
import type { Selection } from './schema';

/** AI omission is a preference, not an application eligibility constraint. */
export function placementIntent(candidates: Candidate[], selection: Selection, guidance: string) {
  const guided = Boolean(guidance.trim());
  const preferred = new Set(selection.selected.map((item) => item.key));
  const additional = guided ? [] : candidates.filter((candidate) => !preferred.has(candidate.key));
  return {
    goal: guided ? ('guided' as const) : ('fill' as const),
    workBudgetMinutes: guided ? selection.workBudgetMinutes : null,
    additionalKeys: new Set(additional.map((candidate) => candidate.key)),
    ordered: [
      ...selection.selected.map((item) => ({
        candidate: candidates.find((candidate) => candidate.key === item.key)!,
        reason: item.reason,
        plannedMinutes: guided ? item.plannedMinutes : undefined,
      })),
      ...additional.map((candidate) => ({
        candidate,
        reason: 'Application fill pass: remaining eligible work in urgency order.',
      })),
    ],
  };
}
