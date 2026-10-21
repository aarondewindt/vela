import { mealKinds, mealTitles, readMealPreferences, type MealKind } from '../meals';
import type { Snapshot } from '../proposals/snapshot';
import type { ProposalDocument, ProposalOperation } from '../proposals/schema';
import { availability, existingBlocks, validateProposal } from '../proposals/validate';
import { wallInstant } from '../proposals/time';
import { earliestGeneratedStart } from './policy';

export type MealOutcome = {
  mealKind: MealKind;
  status: 'scheduled' | 'preserved' | 'unmet' | 'skipped';
  reason: string;
};
export function mealPreferences(s: Snapshot) {
  return readMealPreferences('mealPreferences' in s.settings ? s.settings.mealPreferences : null);
}

/** Requirements are placed before optional work/leisure, without model interpretation. */
export function placeMeals(s: Snapshot, document: ProposalDocument, now: Date): MealOutcome[] {
  const preferences = mealPreferences(s);
  return mealKinds
    .filter((kind) => preferences[kind].enabled)
    .map((mealKind) => {
      const preference = preferences[mealKind];
      const title = mealTitles[mealKind];
      const existing = existingBlocks(s).find((b) => b.mealKind === mealKind);
      if (existing) {
        if (
          ['PLANNED', 'IN_PROGRESS'].includes(existing.status) &&
          existing.endsAt > now &&
          (!availability(s).some(
            (w) => existing.startsAt >= w.startsAt && existing.endsAt <= w.endsAt
          ) ||
            s.events.some(
              (e) => e.isBusy && existing.startsAt < e.endsAt && e.startsAt < existing.endsAt
            ))
        ) {
          return {
            mealKind,
            status: 'unmet',
            reason: `${title}: its existing block conflicts with current availability or calendar commitments. Review or replan it explicitly; its identity and edits are retained.`,
          };
        }
        return {
          mealKind,
          status: ['SKIPPED', 'CANCELED'].includes(existing.status) ? 'skipped' : 'preserved',
          reason: ['SKIPPED', 'CANCELED'].includes(existing.status)
            ? `${title}: skipped or cancelled for this day; not regenerated automatically.`
            : `${title}: existing daily block retained, including individual-day adjustments and outcomes.`,
        };
      }
      const additions = document.operations.filter(
        (op) =>
          (op.type === 'add' || op.type === 'replace') &&
          op.block.kind === 'MEAL' &&
          op.block.mealKind === mealKind
      );
      if (additions.length) {
        return {
          mealKind,
          status: 'scheduled',
          reason: `${title}: already included in this preview.`,
        };
      }
      if (document.operations.length >= 100) {
        return {
          mealKind,
          status: 'unmet',
          reason: `${title}: this preview reached the 100-change limit. Apply the reviewed changes, then generate again.`,
        };
      }
      try {
        const first = Math.max(
          wallInstant(s.date, preference.startMinute, s.timezone).getTime(),
          earliestGeneratedStart(now)
        );
        const last = wallInstant(s.date, preference.endMinute, s.timezone).getTime();
        for (
          let start = first;
          start + preference.durationMinutes * 60000 <= last;
          start += 60000
        ) {
          const operation: ProposalOperation = {
            type: 'add',
            explanation: `${title}: one continuous block for preparation, eating and cleanup.`,
            block: {
              kind: 'MEAL',
              mealKind,
              startsAt: new Date(start).toISOString(),
              endsAt: new Date(start + preference.durationMinutes * 60000).toISOString(),
            },
          };
          try {
            validateProposal(
              s,
              { ...document, operations: [...document.operations, operation] },
              now
            );
            document.operations.push(operation);
            return {
              mealKind,
              status: 'scheduled',
              reason: `${title}: ${preference.durationMinutes} minutes within the preferred window.`,
            };
          } catch {
            // Pure placement rejection; try the next whole-minute placement.
          }
        }
      } catch {
        // Nonexistent/ambiguous local boundaries (DST) need explicit user adjustment.
        return {
          mealKind,
          status: 'unmet',
          reason: `${title}: the preferred window cannot be resolved on this date. Adjust its times.`,
        };
      }
      return {
        mealKind,
        status: 'unmet',
        reason: `${title}: no continuous ${preference.durationMinutes}-minute block fits its window, future availability and commitments. Adjust the meal window or availability and generate again.`,
      };
    });
}
