import type { ProposalDocument } from './schema';

/** Remaining planned minutes after a stable request boundary; completed history is not rewritten. */
export function limitedTaskMinutes(
  blocks: { taskId: string | null; status: string; startsAt: Date; endsAt: Date }[],
  limit: NonNullable<ProposalDocument['taskLimits']>[number]
) {
  const startsAt = new Date(limit.startsAt).getTime();
  return blocks
    .filter(
      (block) => block.taskId === limit.taskId && ['PLANNED', 'IN_PROGRESS'].includes(block.status)
    )
    .reduce(
      (total, block) =>
        total +
        Math.max(0, block.endsAt.getTime() - Math.max(startsAt, block.startsAt.getTime())) / 60000,
      0
    );
}
