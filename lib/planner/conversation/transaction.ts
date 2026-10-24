import 'server-only';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import { conflict } from './resolve';

export async function locked<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        // Same ordering as proposal acceptance. Covers legacy writers and phantoms.
        await tx.$executeRaw`LOCK TABLE "user", "themes", "tasks", "task_dependencies", "task_occurrences", "availability_windows", "day_overrides", "date_availability_windows", "calendar_events", "planner_generation_settings", "daily_plans", "daily_blocks", "daily_plan_category_slots", "planning_proposals", "planner_conversations", "planner_conversation_turns" IN SHARE ROW EXCLUSIVE MODE`;
        return fn(tx);
      },
      { timeout: 15000, maxWait: 5000 }
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (['P2002', 'P2034'].includes(error.code) ||
        (error.code === 'P2010' && ['40001', '40P01', '55P03'].includes(String(error.meta?.code))))
    ) {
      throw conflict('The records changed or are busy. Refresh and retry.');
    }
    throw error;
  }
}
