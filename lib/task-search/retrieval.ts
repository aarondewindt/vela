import 'server-only';
import { prisma } from '@/lib/prisma';
import { AiError } from '@/lib/ai/errors';
import { EmbeddingCollectionError } from '@/lib/embeddings/errors';
import { loadSnapshot, type Snapshot } from '@/lib/planner/proposals/snapshot';
import { planningCandidates } from '@/lib/planner/generation/candidates';
import { taskCollection } from './service';
import { blockNoteText } from './text';

/** Shared retrieval for planner guidance, review and replacements; eligibility remains application-owned. */
export async function retrievePlanningTasks(
  userId: string,
  input: { query: string; date: string; limit: number; semantic: boolean },
  snapshot?: Snapshot,
  signal?: AbortSignal
) {
  const s =
    snapshot ??
    (await prisma.$transaction((tx) => loadSnapshot(tx, userId, input.date), {
      isolationLevel: 'RepeatableRead',
      timeout: 15000,
    }));
  if (s.userId !== userId || s.date !== input.date) {
    throw new Error('Retrieval snapshot does not match the owner and date.');
  }
  const { candidates, warnings } = planningCandidates(s);
  const eligibleIds = new Set(candidates.map((c) => c.taskId));
  const tasks = s.tasks.filter((t) => t.userId === userId && eligibleIds.has(t.id));
  const query = input.query.trim().toLocaleLowerCase();
  const textIds = tasks
    .filter((t) =>
      [t.title, t.brief, t.firstStep, ...t.tags, blockNoteText(t.content)]
        .filter(Boolean)
        .join('\n')
        .toLocaleLowerCase()
        .includes(query)
    )
    .map((t) => t.id);
  let semantic: 'off' | 'available' | 'unavailable' = 'off';
  const semanticIds: string[] = [];
  if (query && input.semantic && tasks.length) {
    try {
      const status = await taskCollection.status(userId);
      if (status.pending) {
        warnings.push(
          `Semantic index has ${status.pending} pending tasks; stale vectors are excluded. Conventional search uses current task content.`
        );
      }
      const found = await taskCollection.search(
        userId,
        input.query,
        input.limit,
        signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
        tasks.map((t) => t.id)
      );
      semantic = 'available';
      // Recheck source versions after inference: a newly edited task is not a current semantic match.
      const current = await prisma.task.findMany({
        where: {
          userId,
          id: { in: found.results.map((t) => t.id) },
          status: { in: ['BACKLOG', 'IN_PROGRESS'] },
        },
        select: { id: true, updatedAt: true },
      });
      const versions = new Map(current.map((t) => [t.id, t.updatedAt.getTime()]));
      for (const match of found.results) {
        const task = tasks.find((t) => t.id === match.id);
        if (task && versions.get(task.id) === task.updatedAt.getTime()) {
          semanticIds.push(task.id);
        }
      }
    } catch (error) {
      if (!(error instanceof AiError || error instanceof EmbeddingCollectionError)) {
        throw error;
      }
      semantic = 'unavailable';
      warnings.push(
        'Semantic retrieval is unavailable; conventional search and urgency ranking remain available.'
      );
    }
  }
  const ids = [...new Set([...textIds, ...semanticIds])].slice(0, input.limit);
  // Important occurrences bypass search limits, even when their text does not match.
  const mandatory = candidates.filter((c) => c.mandatory);
  const matched = new Set(ids);
  const ranked = [
    ...mandatory,
    ...ids.flatMap((id) => candidates.filter((c) => !c.mandatory && c.taskId === id)),
    ...candidates.filter((c) => !c.mandatory && !matched.has(c.taskId)),
  ];
  return { ids, semanticIds, candidates: ranked, semantic, warnings };
}
