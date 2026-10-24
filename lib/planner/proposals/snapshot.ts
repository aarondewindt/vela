import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client';
import { DEFAULT_GENERATOR_OPTIONS } from '../scheduling';

export const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function loadSnapshot(tx: Prisma.TransactionClient, userId: string, date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  const [
    user,
    plans,
    tasks,
    occurrences,
    dependencies,
    windows,
    override,
    events,
    blocks,
    settings,
  ] = await Promise.all([
    tx.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } }),
    tx.dailyPlan.findMany({
      where: { userId, planDate: day },
      orderBy: { version: 'asc' },
      include: { categorySlots: { orderBy: { id: 'asc' } } },
    }),
    tx.task.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      include: { theme: { select: { userId: true, category: true, name: true } } },
    }),
    tx.taskOccurrence.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    tx.taskDependency.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      include: { dependsOnTask: { select: { userId: true, status: true } } },
    }),
    tx.availabilityWindow.findMany({
      where: { userId, weekday: day.getUTCDay(), isActive: true },
      orderBy: { id: 'asc' },
    }),
    tx.dayOverride.findUnique({
      where: { userId_overrideDate: { userId, overrideDate: day } },
      include: { availabilityWindows: { orderBy: { id: 'asc' } } },
    }),
    tx.calendarEvent.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    tx.dailyBlock.findMany({
      where: { userId, plan: { isCurrent: true, userId } },
      orderBy: { id: 'asc' },
    }),
    tx.plannerGenerationSettings.findUnique({ where: { userId } }),
  ]);
  const current = plans.filter((plan) => plan.isCurrent);
  if (current.length > 1) {
    throw new Error(
      'Multiple current plans exist for this date. Resolve them before proposing changes.'
    );
  }
  const plan = current[0] ?? null;
  const snapshot = {
    userId,
    date,
    user,
    plans,
    plan,
    tasks,
    occurrences,
    dependencies,
    windows,
    override,
    events,
    blocks,
    settings: {
      ...DEFAULT_GENERATOR_OPTIONS,
      ...settings,
      mealPreferences: settings?.mealPreferences ?? null,
    },
  };
  return { ...snapshot, hash: fingerprint(snapshot), timezone: plan?.timezone ?? user.timezone };
}
export type Snapshot = Awaited<ReturnType<typeof loadSnapshot>> & {
  // Ephemeral constraints used by the same scheduler during proposal generation.
  planningExclusions?: { startsAt: Date; endsAt: Date }[];
};
