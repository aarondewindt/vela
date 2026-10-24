import 'server-only';
import { proposalService } from '../proposals/service';
import { plannerService } from '../service';

export async function plannerChatContext(
  userId: string,
  date: string,
  selection?: { focusedBlockId?: string | null; focusedTaskId?: string | null }
) {
  const [context, day] = await Promise.all([
    proposalService.context(userId, date),
    plannerService.getDayData(userId, date),
  ]);
  const focusedBlock = context.blocks.find((b) => b.id === selection?.focusedBlockId);
  const focusedTask = context.candidates.find((c) => c.taskId === selection?.focusedTaskId);
  return {
    date,
    timezone: context.timezone,
    userTimezone: day.timezone,
    focusedBlock: focusedBlock
      ? { ...focusedBlock, title: focusedBlock.title.slice(0, 240) }
      : undefined,
    focusedTask: focusedTask
      ? { ...focusedTask, title: focusedTask.title.slice(0, 240) }
      : undefined,
    availability: day.availability.slice(0, 24),
    blocks: context.blocks.slice(0, 80).map((block) => ({
      ...block,
      title: block.title.slice(0, 240),
    })),
    candidates: context.candidates.slice(0, 40).map((task) => ({
      ...task,
      title: task.title.slice(0, 240),
    })),
    omittedBlocks: Math.max(0, context.blocks.length - 80),
    omittedCandidates: Math.max(0, context.candidates.length - 40),
  };
}
