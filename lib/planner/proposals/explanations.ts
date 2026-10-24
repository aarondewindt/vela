import type { ProposalDocument } from './schema';

/** Selection provenance only; previous allocation counts are not carried into a revised preview. */
export function selectionExplanation(document: ProposalDocument) {
  return (
    document.selectionExplanation ??
    (document.generation
      ? {
          summary: (document.generation.selectionSummary ?? document.generation.summary).slice(
            0,
            1500
          ),
          reasons: document.generation.outcomes.map((outcome) => ({
            title: outcome.title.slice(0, 240),
            reason: (outcome.selectionReason ?? outcome.reason).slice(0, 1000),
          })),
        }
      : undefined)
  );
}
