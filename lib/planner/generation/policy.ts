// Placement preferences only: manual proposals still accept any valid whole-minute task.
export const REVIEW_BUFFER_MINUTES = 10;
export const MIN_PARTIAL_TASK_MINUTES = 10;

export function earliestGeneratedStart(now: Date) {
  return Math.ceil((now.getTime() + REVIEW_BUFFER_MINUTES * 60_000) / 60_000) * 60_000;
}
