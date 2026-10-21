import 'server-only';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { Prisma } from '../../generated/prisma/client';
import { taskCollection } from './service';

type Claim = { userId: string; revision: number; attempts: number; leaseId: string };
const leaseMs = 300_000;

export function taskIndexRetryDelay(attempts: number) {
  return Math.min(3_600_000, 15_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 8));
}

/** One bounded owner job. Collection and job leases fence concurrent processes and late acknowledgements. */
export async function processNextTaskIndexJob(userId?: string) {
  const leaseId = randomUUID();
  const jobs = await prisma.$queryRaw<Claim[]>(Prisma.sql`
    UPDATE task_index_jobs j SET "leaseId" = ${leaseId}::uuid,
      "leaseExpiresAt" = ${new Date(Date.now() + leaseMs)}, attempts = j.attempts + 1, "updatedAt" = CURRENT_TIMESTAMP
    WHERE j."userId" = (SELECT "userId" FROM task_index_jobs
      WHERE revision > "completedRevision" AND "runAfter" <= CURRENT_TIMESTAMP
        AND ("leaseId" IS NULL OR "leaseExpiresAt" < CURRENT_TIMESTAMP)
        ${userId ? Prisma.sql`AND "userId" = ${userId}` : Prisma.empty}
      ORDER BY "runAfter", "userId" FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING j."userId", j.revision, j.attempts, j."leaseId"`);
  const job = jobs[0];
  if (!job) {
    return { processed: false };
  }
  // Heartbeats belong to this awaited worker operation, never to an HTTP request.
  let heartbeat: Promise<unknown> = Promise.resolve();
  let heartbeatFailed = false;
  const timer = setInterval(() => {
    heartbeat = heartbeat
      .then(async () => {
        const renewed = await prisma.taskIndexJob.updateMany({
          where: { userId: job.userId, leaseId },
          data: { leaseExpiresAt: new Date(Date.now() + leaseMs) },
        });
        if (!renewed.count) {
          heartbeatFailed = true;
        }
      })
      .catch(() => {
        heartbeatFailed = true;
      });
  }, 30_000);
  try {
    const result = await taskCollection.synchronize(job.userId);
    // New writes during inference remain pending even if this pass published some of them.
    if (heartbeatFailed) {
      throw new Error('Index job lease renewal failed');
    }
    const acknowledged = await prisma.taskIndexJob.updateMany({
      where: { userId: job.userId, leaseId },
      data: {
        completedRevision: job.revision,
        leaseId: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });
    if (!acknowledged.count) {
      throw new Error('The index job was superseded');
    }
    return { processed: true, succeeded: true, ...result };
  } catch {
    const failed = await prisma.taskIndexJob.updateMany({
      where: { userId: job.userId, leaseId, revision: job.revision },
      data: {
        leaseId: null,
        leaseExpiresAt: null,
        runAfter: new Date(Date.now() + taskIndexRetryDelay(job.attempts)),
        lastError: 'Task indexing failed. Check the model configuration and worker, then retry.',
      },
    });
    if (!failed.count) {
      // A fresh source change/manual retry must not inherit this older attempt's backoff.
      await prisma.taskIndexJob.updateMany({
        where: { userId: job.userId, leaseId },
        data: { leaseId: null, leaseExpiresAt: null },
      });
    }
    return { processed: true, succeeded: false };
  } finally {
    clearInterval(timer);
    await heartbeat;
  }
}
