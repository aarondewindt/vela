import 'server-only';
import type { Prisma } from '../../generated/prisma/client';

/** Same transaction as the source change; keep any in-flight lease and coalesce revisions. */
export async function enqueueTaskIndex(db: Prisma.TransactionClient, userId: string) {
  await db.taskIndexJob.upsert({
    where: { userId },
    create: { userId },
    update: { revision: { increment: 1 }, attempts: 0, runAfter: new Date(), lastError: null },
  });
}
