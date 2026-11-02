import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@/lib/trpc/root';
type DayData = inferRouterOutputs<AppRouter>['planner']['getDayData'];
type Draft = NonNullable<inferRouterOutputs<AppRouter>['plannerDraft']['read']['draft']>;

export function draftDayData(
  day: DayData | undefined,
  draft: Draft | null | undefined
): DayData | undefined {
  if (!day || !draft) {
    return day;
  }
  const stamp = new Date(0);
  const planId = draft.id;
  return {
    ...day,
    plan: {
      ...(day.plan ?? {
        id: planId,
        userId: '',
        planDate: new Date(`${draft.date}T00:00:00Z`),
        timezone: draft.timezone,
        version: 0,
        isCurrent: false,
        generatedBy: 'MANUAL',
        explanationJson: null,
        createdAt: stamp,
        updatedAt: stamp,
        finalizedAt: null,
      }),
      status: 'DRAFT',
      dailyBlocks: draft.state.blocks.map((b) => ({
        id: b.id,
        userId: '',
        planId,
        taskOccurrenceId: b.occurrenceId,
        taskOccurrence: b.taskId ? { taskId: b.taskId } : null,
        calendarEventId: b.calendarEventId,
        calendarEvent: b.calendarEventId
          ? {
              id: b.calendarEventId,
              isBusy: day.events.find((e) => e.id === b.calendarEventId)?.isBusy ?? true,
            }
          : null,
        category: b.category,
        title: b.title,
        mealKind: b.mealKind ?? null,
        brief: day.plan?.dailyBlocks.find((old) => old.id === b.id)?.brief ?? null,
        content: null,
        startsAt: new Date(b.startsAt),
        endsAt: new Date(b.endsAt),
        durationMinutes: b.durationMinutes,
        status: b.status,
        source: b.source,
        position: null,
        isFixed: b.isFixed,
        manualOverride: b.manualOverride,
        isLocked: b.isLocked,
        completedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
      })),
      categorySlots: draft.state.slots.map((slot) => ({
        ...slot,
        planId,
        startsAt: new Date(slot.startsAt),
        endsAt: new Date(slot.endsAt),
        createdAt: stamp,
        updatedAt: stamp,
      })),
    },
  };
}
