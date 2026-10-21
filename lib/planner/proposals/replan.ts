import { placeMeals, mealPreferences } from '../generation/meals';
import { mealTitles } from '../meals';
import type { Snapshot } from './snapshot';
import type { ProposalDocument, ProposalOperation, ReplanInput } from './schema';
import { availability, existingBlocks, validateProposal } from './validate';
import { timeMinute, wallInstant } from './time';
import { earliestGeneratedStart } from '../generation/policy';

const iso = (time: number) => new Date(time).toISOString();
const MINUTE = 60_000;

/** Preserve order and identity; move only the selected work and affected flexible remainder. */
export function replanDay(s: Snapshot, input: ReplanInput, requestHash: string, now = new Date()) {
  const original = existingBlocks(s).sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id)
  );
  const selected =
    input.action === 'replan' ? undefined : original.find((b) => b.id === input.blockId);
  if (input.action !== 'replan' && !selected) {
    throw new Error('Choose a block in the current plan.');
  }
  const cutoff = earliestGeneratedStart(now);
  const instant = (time: string | undefined) => {
    if (!time) {
      throw new Error('Specify the time for this action.');
    }
    return wallInstant(s.date, timeMinute(time), s.timezone).toISOString();
  };
  let action: ProposalOperation | undefined;
  const explanation = input.explanation;
  if (selected) {
    const blockId = selected.id;
    if (input.action === 'finish') {
      action = {
        type: 'finish',
        blockId,
        endsAt: instant(input.endTime),
        completeTask: input.completeTask,
        explanation,
      };
    } else if (input.action === 'extend') {
      action = {
        type: 'extend',
        blockId,
        endsAt: instant(input.endTime),
        estimatedMinutes: input.estimatedMinutes,
        explanation,
      };
    } else if (input.action === 'skip') {
      action = { type: 'skip', blockId, explicit: true, explanation };
    } else if (input.action === 'cancel') {
      action = {
        type: 'remove',
        blockId,
        explicit: true,
        explanation: `${explanation} Scheduled block cancelled; underlying task retained.`,
      };
    } else if (input.action === 'postpone') {
      const startsAt = instant(input.startTime);
      if (new Date(startsAt) <= selected.startsAt) {
        throw new Error('Postponement must move work later.');
      }
      action = {
        type: 'move',
        blockId,
        explicit: true,
        startsAt,
        endsAt: iso(new Date(startsAt).getTime() + selected.durationMinutes * MINUTE),
        explanation,
      };
    } else if (input.action === 'replace') {
      const [taskId, occurrence] = (input.candidateId ?? '').split(':');
      if (!taskId || !occurrence) {
        throw new Error('Choose an eligible replacement task.');
      }
      action = {
        type: 'replace',
        blockId,
        explicit: true,
        explanation,
        block: {
          kind: 'TASK',
          taskId,
          occurrenceId: occurrence === 'new' ? null : occurrence,
          startsAt: selected.startsAt.toISOString(),
          endsAt: selected.endsAt.toISOString(),
        },
      };
    }
  }
  const flexible = original.filter(
    (b) =>
      b.id !== selected?.id &&
      b.status === 'PLANNED' &&
      !b.isFixed &&
      b.source !== 'MANUAL' &&
      !b.calendarEventId &&
      b.startsAt.getTime() >= Math.ceil(now.getTime() / MINUTE) * MINUTE &&
      (!selected || b.startsAt >= selected.startsAt)
  );
  if (flexible.length > 98) {
    throw new Error('Too many remaining blocks for one proposal. Replan a smaller remainder.');
  }
  flexible.sort((a, b) => Number(Boolean(b.mealKind)) - Number(Boolean(a.mealKind)));
  const removals = new Map<string, ProposalOperation>(
    flexible.map((b) => [
      b.id,
      {
        type: 'remove',
        blockId: b.id,
        explanation: `${b.title} no longer fits the remaining day. Unfinished work is retained for planning.`,
      },
    ])
  );
  const document: ProposalDocument = {
    schemaVersion: 1,
    operations: [],
    replan: { requestHash, warnings: [] },
  };
  const mealAdditions: ProposalOperation[] = [];
  const assemble = () => {
    document.operations = [...(action ? [action] : []), ...removals.values(), ...mealAdditions];
  };
  assemble();
  // Prove the explicit request is legal before searching for downstream placements.
  validateProposal(s, document, now);
  const mealOutcomes = placeMeals(s, document, now);
  mealAdditions.push(...document.operations.filter((op) => op.type === 'add'));
  document.replan!.warnings.push(
    ...mealOutcomes
      .filter((m) => m.status === 'unmet' && !flexible.some((b) => b.mealKind === m.mealKind))
      .map((m) => m.reason)
  );
  assemble();
  let trials = 0;
  let cursor = Math.ceil(now.getTime() / MINUTE) * MINUTE;
  for (const block of flexible) {
    const sameWork =
      selected?.taskId &&
      block.taskId === selected.taskId &&
      (!s.tasks.find((t) => t.id === block.taskId)?.isRecurring ||
        block.occurrenceId === selected.occurrenceId);
    if (input.action === 'finish' && input.completeTask && sameWork) {
      removals.set(block.id, {
        type: 'remove',
        blockId: block.id,
        explanation:
          'Release future allocation because this task or occurrence was explicitly completed.',
      });
      continue;
    }
    const removed = removals.get(block.id)!;
    const preference = block.mealKind ? mealPreferences(s)[block.mealKind] : null;
    const blockCursor = block.mealKind ? Math.ceil(now.getTime() / MINUTE) * MINUTE : cursor;
    const accepts = (op: ProposalOperation | null) => {
      if (++trials > 10_000) {
        throw new Error(
          'This remainder needs too many placement trials. Adjust fewer blocks and preview again.'
        );
      }
      if (op) {
        removals.set(block.id, op);
      } else {
        removals.delete(block.id);
      }
      assemble();
      try {
        validateProposal(s, document, now);
        return true;
      } catch {
        removals.set(block.id, removed);
        assemble();
        return false;
      }
    };
    if (
      !input.pullForward &&
      block.startsAt.getTime() >= blockCursor &&
      accepts({
        type: 'move',
        blockId: block.id,
        startsAt: block.startsAt.toISOString(),
        endsAt: block.endsAt.toISOString(),
        explanation: input.explanation,
      }) &&
      accepts(null)
    ) {
      if (!block.mealKind) {
        cursor = block.endsAt.getTime();
      }
      continue;
    }
    let placed = false;
    for (const window of availability(s)) {
      const first = Math.max(
        blockCursor,
        cutoff,
        ...(preference ? [wallInstant(s.date, preference.startMinute, s.timezone).getTime()] : []),
        window.startsAt.getTime(),
        input.pullForward ? cutoff : block.startsAt.getTime()
      );
      for (
        let start = first;
        start + block.durationMinutes * MINUTE <=
        Math.min(
          window.endsAt.getTime(),
          preference ? wallInstant(s.date, preference.endMinute, s.timezone).getTime() : Infinity
        );
        start += MINUTE
      ) {
        const end = start + block.durationMinutes * MINUTE;
        if (
          accepts({
            type: 'move',
            blockId: block.id,
            startsAt: iso(start),
            endsAt: iso(end),
            explanation: `${explanation} Preserve this block’s duration and move it within the remaining availability.`,
          })
        ) {
          if (!block.mealKind) {
            cursor = end;
          }
          placed = true;
          break;
        }
      }
      if (placed) {
        break;
      }
    }
    if (!placed) {
      document.replan!.warnings.push(
        block.mealKind
          ? `${mealTitles[block.mealKind]} requirement unmet: ${block.durationMinutes} minutes no longer fit. Adjust meal preferences or availability.`
          : `${block.title}: ${block.durationMinutes} scheduled minutes no longer fit. The task and unfinished work are kept.`
      );
    }
  }
  assemble();
  const newStarts = document.operations.flatMap((op) =>
    op.type === 'move' || op.type === 'resize'
      ? [op.startsAt]
      : op.type === 'replace' || op.type === 'add'
        ? [op.block.startsAt]
        : []
  );
  if (newStarts.length) {
    document.replan!.reviewBy = newStarts.sort()[0];
  }
  validateProposal(s, document, now);
  return document;
}
