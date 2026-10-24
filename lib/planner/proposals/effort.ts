/** Unfinished work can continue on another day without moving its existing blocks. */
export function countsTowardDayEffort(
  block: { status: string; startsAt: Date; endsAt: Date },
  dayStart: Date,
  dayEnd: Date
) {
  return (
    block.status === 'DONE' ||
    (['PLANNED', 'IN_PROGRESS'].includes(block.status) &&
      block.startsAt < dayEnd &&
      block.endsAt > dayStart)
  );
}

// Status determines completion. An exhausted estimate must not hide unfinished work.
export function unfinishedEffortBudget(estimate: number, completedMinutes: number) {
  return completedMinutes > 0 && completedMinutes >= estimate ? completedMinutes + 25 : estimate;
}
