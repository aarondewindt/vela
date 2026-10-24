import { selectionExplanation } from '../proposals/explanations';
import type { Snapshot } from '../proposals/snapshot';
import type { ProposalDocument, ProposalOperation } from '../proposals/schema';
import {
  availability,
  eligible,
  existingBlocks,
  validateProposal,
  type ProposalBlock,
} from '../proposals/validate';
import { wallInstant } from '../proposals/time';
import { planningCandidates } from '../generation/candidates';

export type Concern = { code: string; blockIds: string[]; taskIds: string[]; explanation: string };
export type Correction = {
  blockId: string;
  title: string;
  explanation: string;
  displaced: { title: string; minutes: number; due: string | null; deadlineRisk: boolean };
  replacement: {
    title: string;
    minutes: number;
    remainingMinutes: number;
    due: string | null;
    deadlineRisk: boolean;
  } | null;
  document: ProposalDocument;
};
const occupied = (b: ProposalBlock) => ['PLANNED', 'IN_PROGRESS', 'DONE'].includes(b.status);
const overlap = (a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) =>
  a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/** Compose a correction against the original snapshot, including virtual proposal blocks. */
function correctedDocument(
  base: ProposalDocument | undefined,
  block: ProposalBlock,
  replacement: ProposalOperation | null
): ProposalDocument {
  const operations = [...(base?.operations ?? [])];
  const index = block.id.startsWith('new:')
    ? Number(block.id.slice(4))
    : operations.findIndex((op) => op.type !== 'add' && op.blockId === block.id);
  const previous = operations[index];
  if (previous) {
    if (previous.type === 'add') {
      if (replacement?.type === 'replace') {
        operations[index] = {
          type: 'add',
          block: replacement.block,
          explanation: replacement.explanation,
        };
      } else {
        operations.splice(index, 1);
      }
    } else {
      const blockId = previous.blockId;
      operations[index] =
        replacement?.type === 'replace'
          ? { ...replacement, blockId }
          : { type: 'remove', blockId, explanation: 'Release this allocation for later planning.' };
    }
  } else if (replacement) {
    operations.push(replacement);
  } else {
    operations.push({
      type: 'remove',
      blockId: block.id,
      explanation: 'Release this allocation for later planning.',
    });
  }
  // Generation reports describe the old allocation and must not survive a correction.
  return {
    schemaVersion: 1,
    taskLimits: base?.taskLimits,
    selectionExplanation: base ? selectionExplanation(base) : undefined,
    operations,
    ...(base?.freeIntervals ? { freeIntervals: base.freeIntervals } : {}),
    ...(base?.reservations ? { reservations: base.reservations } : {}),
  };
}

export function reviewSchedule(s: Snapshot, document?: ProposalDocument, now = new Date()) {
  const projection = document ? validateProposal(s, document, now) : null;
  const blocks = (projection?.final ?? existingBlocks(s)).filter(
    (b) =>
      occupied(b) &&
      (!b.calendarEventId || s.events.find((e) => e.id === b.calendarEventId)?.isBusy !== false)
  );
  const conflicts: Concern[] = [];
  const report = (code: string, affected: ProposalBlock[], explanation: string) => {
    conflicts.push({
      code,
      blockIds: affected.map((b) => b.id),
      taskIds: [...new Set(affected.flatMap((b) => (b.taskId ? [b.taskId] : [])))],
      explanation,
    });
  };
  const windows = availability(s);
  const dayStart = wallInstant(s.date, 0, s.timezone);
  const dayEnd = wallInstant(s.date, 1440, s.timezone);
  const slots = [...(s.plan?.categorySlots ?? []), ...(projection?.reservations ?? [])];
  for (const [i, block] of blocks.entries()) {
    for (const other of blocks.slice(i + 1)) {
      if (overlap(block, other)) {
        report('OVERLAP', [block, other], `${block.title} overlaps ${other.title}.`);
      }
    }
    for (const event of s.events.filter(
      (e) => e.isBusy && e.id !== block.calendarEventId && overlap(block, e)
    )) {
      report(
        'BUSY_EVENT',
        [block],
        `${block.title} overlaps busy calendar event ${event.title} (${event.startsAt.toISOString()}–${event.endsAt.toISOString()}).`
      );
    }
    if (
      block.endsAt <= block.startsAt ||
      block.durationMinutes !== (block.endsAt.getTime() - block.startsAt.getTime()) / 60000 ||
      !Number.isInteger(block.durationMinutes)
    ) {
      report('INVALID_INTERVAL', [block], `${block.title} has an invalid interval or duration.`);
    }
    if (
      block.startsAt < dayStart ||
      block.endsAt > dayEnd ||
      !windows.some((w) => block.startsAt >= w.startsAt && block.endsAt <= w.endsAt)
    ) {
      report(
        'AVAILABILITY',
        [block],
        `${block.title} falls outside the selected day's effective availability.`
      );
    }
    if (
      block.category !== 'REST' &&
      slots.some(
        (slot) =>
          overlap(block, slot) &&
          (slot.category !== block.category ||
            block.startsAt < slot.startsAt ||
            block.endsAt > slot.endsAt)
      )
    ) {
      report('CATEGORY', [block], `${block.title} conflicts with a category reservation.`);
    }
    if (
      block.category === 'LEISURE' &&
      !slots.some(
        (slot) =>
          slot.category === 'LEISURE' &&
          block.startsAt >= slot.startsAt &&
          block.endsAt <= slot.endsAt
      )
    ) {
      report('LEISURE', [block], `${block.title} needs a matching leisure reservation.`);
    }
    if (block.taskId && block.status !== 'DONE') {
      try {
        eligible(s, block.taskId, block.occurrenceId);
      } catch (error) {
        report('ELIGIBILITY', [block], `${block.title}: ${(error as Error).message}`);
      }
      const task = s.tasks.find((t) => t.id === block.taskId);
      if (task?.earliestStartAt && block.startsAt < task.earliestStartAt) {
        report(
          'EARLIEST_START',
          [block],
          `${block.title} starts before its recorded earliest start.`
        );
      }
      const allocations = [
        ...s.blocks
          .filter(
            (b) => b.planId !== s.plan?.id && ['PLANNED', 'IN_PROGRESS', 'DONE'].includes(b.status)
          )
          .map((b) => ({ occurrenceId: b.taskOccurrenceId, durationMinutes: b.durationMinutes })),
        ...blocks,
      ];
      const allocated = allocations
        .filter((b) =>
          task?.isRecurring
            ? block.occurrenceId
              ? b.occurrenceId === block.occurrenceId
              : 'taskId' in b && b.taskId === block.taskId && !b.occurrenceId
            : s.occurrences.some((o) => o.id === b.occurrenceId && o.taskId === block.taskId) ||
              ('taskId' in b && b.taskId === block.taskId)
        )
        .reduce((sum, b) => sum + b.durationMinutes, 0);
      const estimate =
        projection?.taskChanges.find((change) => change.taskId === task?.id)?.estimatedMinutes ??
        task?.estimatedMinutes ??
        25;
      if (task && allocated > estimate) {
        report(
          'OVERALLOCATED',
          [block],
          `${block.title} has ${allocated} committed/completed minutes against ${estimate} estimated minutes${task.estimatedMinutes === null ? ' (application default)' : ''}.`
        );
      }
    }
  }
  // Reuse the exact session policy, including busy gaps and finish-only extensions.
  const validation = projection ?? validateProposal(s, { schemaVersion: 1, operations: [] }, now);
  for (const id of validation.sessionViolations) {
    report(
      'SESSION_POLICY',
      blocks.filter((b) => b.id === id),
      'This block exceeds the configured session policy; review breaks and the finish-only extension.'
    );
  }
  const corrections: Correction[] = [];
  const candidateResult = planningCandidates(
    projection ? { ...s, blocks: s.blocks.filter((b) => b.planId !== s.plan?.id) } : s
  );
  const candidates = candidateResult.candidates
    .map((candidate) => ({
      ...candidate,
      remaining:
        candidate.remaining -
        (projection
          ? blocks
              .filter(
                (b) =>
                  b.taskId === candidate.taskId &&
                  (!s.tasks.find((t) => t.id === candidate.taskId)?.isRecurring ||
                    b.occurrenceId === candidate.occurrenceId)
              )
              .reduce((sum, b) => sum + b.durationMinutes, 0)
          : 0),
    }))
    .filter((candidate) => candidate.remaining > 0);
  const deadline = (value: Date | null) => value?.toISOString() ?? null;
  const risky = (due: Date | null) => Boolean(due && due < dayEnd);
  for (const block of blocks) {
    // No inferred override for manual/fixed work, even when the source proposal had one.
    if (
      block.status !== 'PLANNED' ||
      block.startsAt < now ||
      block.isFixed ||
      block.source === 'MANUAL' ||
      block.calendarEventId
    ) {
      continue;
    }
    const task = s.tasks.find((t) => t.id === block.taskId);
    const due =
      s.occurrences.find((o) => o.id === block.occurrenceId)?.dueAt ?? task?.dueDate ?? null;
    const displaced = {
      title: block.title,
      minutes: block.durationMinutes,
      due: deadline(due),
      deadlineRisk: risky(due),
    };
    const accept = (
      candidateDocument: ProposalDocument,
      correction: Omit<Correction, 'document'>
    ) => {
      // Rejections here are expected placement search results, not swallowed IO failures.
      try {
        if (!candidateDocument.operations.length && !candidateDocument.reservations?.length) {
          return;
        }
        validateProposal(s, candidateDocument, now);
        corrections.push({ ...correction, document: candidateDocument });
      } catch {
        /* This alternative is not valid in the complete schedule. */
      }
    };
    accept(correctedDocument(document, block, null), {
      blockId: block.id,
      title: `Release ${block.title}`,
      explanation:
        'Remove this allocation; the task and its remaining work are retained for later planning.',
      displaced,
      replacement: null,
    });
    let count = 0;
    for (const candidate of candidates) {
      if (candidate.taskId === block.taskId || candidate.remaining > block.durationMinutes) {
        continue;
      }
      const endsAt = new Date(block.startsAt.getTime() + candidate.remaining * 60000);
      const explanation = `Replace ${block.title} with ${candidate.title}; ${candidate.remaining} minutes fit in the original ${block.durationMinutes}-minute slot. Displaced work remains unscheduled.`;
      const operation: ProposalOperation = {
        type: 'replace',
        blockId: block.id,
        block: {
          kind: 'TASK',
          taskId: candidate.taskId,
          occurrenceId: candidate.occurrenceId,
          startsAt: block.startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
        explanation,
      };
      const before = corrections.length;
      accept(correctedDocument(document, block, operation), {
        blockId: block.id,
        title: `Replace with ${candidate.title}`,
        explanation,
        displaced,
        replacement: {
          title: candidate.title,
          minutes: candidate.remaining,
          remainingMinutes: 0,
          due: deadline(candidate.due),
          deadlineRisk: risky(candidate.due),
        },
      });
      if (corrections.length > before && ++count === 3) {
        break;
      }
    }
  }
  return { conflicts, corrections, blocks, warnings: candidateResult.warnings };
}
