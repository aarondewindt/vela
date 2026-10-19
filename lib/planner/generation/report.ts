import type { ProposalDocument } from '../proposals/schema';
import type { Candidate } from './candidates';

/** Describe the schedule actually produced, independently of AI selection prose. */
export function placementReport(
  candidates: Candidate[],
  selectedKeys: Set<string>,
  document: ProposalDocument,
  date: string,
  timezone: string
) {
  const additions = document.operations.flatMap((op) => (op.type === 'add' ? [op.block] : []));
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const outcomes = candidates.map((candidate) => {
    const placements = additions
      .filter(
        (block) =>
          block.kind === 'TASK' &&
          block.taskId === candidate.taskId &&
          block.occurrenceId === candidate.occurrenceId
      )
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    const scheduledMinutes = placements.reduce(
      (total, block) =>
        total + (new Date(block.endsAt).getTime() - new Date(block.startsAt).getTime()) / 60000,
      0
    );
    const remainingMinutes = candidate.remaining - scheduledMinutes;
    const times = placements
      .map(
        (block) =>
          `${format.format(new Date(block.startsAt))}–${format.format(new Date(block.endsAt))}`
      )
      .join('; ');
    return {
      key: candidate.key,
      title: candidate.title,
      scheduledMinutes,
      remainingMinutes,
      deadlineRisk: Boolean(
        candidate.due && candidate.due.toISOString().slice(0, 10) <= date && remainingMinutes > 0
      ),
      reason: placements.length
        ? `Placed ${scheduledMinutes} minutes: ${times} (${timezone}).${remainingMinutes ? ` ${remainingMinutes} minutes remain unscheduled.` : ''}`
        : selectedKeys.has(candidate.key)
          ? 'Selected, but no suitable placement fits the available time, review buffer, work budget and scheduling preferences. This task remains unscheduled.'
          : 'Not selected for placement. This task remains unscheduled.',
    };
  });
  const minutes = outcomes.reduce((total, outcome) => total + outcome.scheduledMinutes, 0);
  const remaining = outcomes.reduce((total, outcome) => total + outcome.remainingMinutes, 0);
  const count = outcomes.filter((outcome) => outcome.scheduledMinutes > 0).length;
  const starts = [
    ...additions.map((block) => block.startsAt),
    ...(document.reservations ?? []).map((slot) => slot.startsAt),
  ].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return {
    summary: `Planned ${minutes} task minutes across ${count} ${count === 1 ? 'task' : 'tasks'}. ${remaining} task minutes remain unscheduled.`,
    reviewBy: starts[0],
    outcomes,
  };
}
