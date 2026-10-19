import type { Snapshot } from '../proposals/snapshot';
import { eligible } from '../proposals/validate';
import { supportedRecurrence } from '../proposals/recurrence';
import { classifyCandidate, defaultLeadTimeDays, sortTasksByPlanningPriority } from '../scheduling';

export type Candidate = {
  key: string;
  taskId: string;
  occurrenceId: string | null;
  title: string;
  remaining: number;
  category: 'WORK' | 'LIFE' | 'LEISURE' | 'REST';
  due: Date | null;
  mandatory: boolean;
};

export function planningCandidates(s: Snapshot) {
  const warnings: string[] = [];
  const day = new Date(`${s.date}T00:00:00Z`);
  const dueDates = new Map(s.tasks.map((t) => [t.id, t.dueDate]));
  // Deadlines propagate through hard prerequisites without pretending they are complete.
  for (let pass = 0; pass < s.tasks.length; pass++) {
    let changed = false;
    for (const dependency of s.dependencies.filter((d) => d.isHardBlock)) {
      const due = dueDates.get(dependency.blockedTaskId);
      const previous = dueDates.get(dependency.dependsOnTaskId);
      if (due && (!previous || due < previous)) {
        dueDates.set(dependency.dependsOnTaskId, due);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  const candidates: Candidate[] = [];
  for (const task of sortTasksByPlanningPriority(
    s.tasks.map((t) => ({ ...t, dueDate: dueDates.get(t.id) ?? null })),
    day
  )) {
    if (!['BACKLOG', 'IN_PROGRESS'].includes(task.status)) {
      continue;
    }
    if (task.isRecurring && !supportedRecurrence(task.recurrenceRule)) {
      warnings.push(`${task.title}: unsupported recurrence rule; review it manually.`);
      continue;
    }
    const occurrences = s.occurrences.filter(
      (o) =>
        o.taskId === task.id &&
        ['PENDING', 'SCHEDULED'].includes(o.status) &&
        o.occurrenceDate <= day
    );
    const choices: (string | null)[] = occurrences.map((o) => o.id);
    // A recurring selected-day occurrence remains virtual until acceptance.
    if (!choices.length || task.isRecurring) {
      choices.push(null);
    }
    for (const occurrenceId of choices) {
      try {
        eligible(s, task.id, occurrenceId);
      } catch (error) {
        if (error instanceof Error && /prerequisite/.test(error.message)) {
          warnings.push(
            `${task.title}: unresolved hard prerequisite (including possible dependency cycles).`
          );
        }
        continue;
      }
      const allocated = s.blocks
        .filter(
          (b) =>
            ['PLANNED', 'IN_PROGRESS', 'DONE'].includes(b.status) &&
            (task.isRecurring
              ? Boolean(occurrenceId) && b.taskOccurrenceId === occurrenceId
              : s.occurrences.some((o) => o.id === b.taskOccurrenceId && o.taskId === task.id))
        )
        .reduce((total, b) => total + b.durationMinutes, 0);
      const remaining = Math.max(0, (task.estimatedMinutes ?? 25) - allocated);
      if (!remaining) {
        continue;
      }
      const due = s.occurrences.find((o) => o.id === occurrenceId)?.dueAt ?? task.dueDate;
      const tier = classifyCandidate({
        priority: task.priority,
        size: task.size,
        daysUntilDue: due ? Math.floor((due.getTime() - day.getTime()) / 86400000) : null,
        leadTimeDays: task.leadTimeDays ?? defaultLeadTimeDays(task.size, task.priority),
      });
      candidates.push({
        key: `${task.id}:${occurrenceId ?? 'new'}`,
        taskId: task.id,
        occurrenceId,
        title: task.title,
        remaining,
        category: task.category ?? task.theme?.category ?? 'WORK',
        due,
        mandatory: tier !== 'FILLER',
      });
    }
  }
  return { candidates, warnings: [...new Set(warnings)] };
}
