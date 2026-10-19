import type { Snapshot } from '../proposals/snapshot';
import { DEFAULT_GENERATOR_OPTIONS } from '../scheduling';

export const date = '2030-01-07';
export const at = (time: string) => new Date(`${date}T${time}:00Z`);
export const taskId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function fixture(durations = [60, 45]): Snapshot {
  return {
    userId: 'owner',
    date,
    timezone: 'UTC',
    hash: 'a'.repeat(64),
    user: { timezone: 'UTC' },
    plans: [],
    plan: null,
    tasks: durations.map((estimatedMinutes, i) => ({
      id: taskId(i + 1),
      userId: 'owner',
      title: `Task ${i + 1}`,
      status: 'BACKLOG',
      estimatedMinutes,
      isRecurring: false,
      recurrenceRule: null,
      createdAt: at('00:00'),
      category: 'WORK',
      theme: null,
      earliestStartAt: null,
      dueDate: null,
      priority: 3,
      size: 2,
      leadTimeDays: null,
      content: null,
      brief: null,
      firstStep: null,
      tags: [],
    })),
    occurrences: [],
    dependencies: [],
    blocks: [],
    events: [],
    override: null,
    windows: [{ startMinute: 540, endMinute: 1020 }],
    settings: { ...DEFAULT_GENERATOR_OPTIONS, leisureMinutes: 0 },
  } as unknown as Snapshot;
}
