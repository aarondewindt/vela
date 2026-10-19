import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { Prisma } from '../../../generated/prisma/client';
import { importHealthStates } from '@/lib/health/import';
import { HomeAssistantClient, HomeAssistantError } from './client';
import { decryptToken } from './security';

export async function syncHomeAssistant(userId: string, signal: AbortSignal) {
  const leaseId = randomUUID();
  const claimed = await prisma.homeAssistantConnection.updateMany({
    where: {
      userId,
      enabled: true,
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
    },
    data: { leaseId, leaseExpiresAt: new Date(Date.now() + 60000), status: 'Connecting' },
  });
  if (!claimed.count) {
    return { claimed: false, succeeded: true };
  }
  const stop = new AbortController();
  const abort = () => stop.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) {
    abort();
  }
  let revision: number | undefined;
  let historyIncomplete = false;
  let pending: Promise<void> = Promise.resolve();
  let failure: unknown;
  let queued = 0;
  const schedule = (operation: () => Promise<void>) => {
    queued++;
    if (queued > 2000) {
      failure = new HomeAssistantError(
        'Sync queue exceeded the limit. Reconnecting to recover history.'
      );
      stop.abort();
    }
    pending = pending
      .then(async () => {
        if (!failure) {
          await operation();
        }
      })
      .catch((error) => {
        failure = error;
        stop.abort();
      })
      .finally(() => {
        queued--;
      });
  };
  let heartbeatPending: Promise<void> = Promise.resolve();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let reconcileTimer: ReturnType<typeof setInterval> | undefined;
  let listener: Promise<void> | undefined;
  let endTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const connection = await prisma.homeAssistantConnection.findUniqueOrThrow({
      where: { userId },
      include: { mappings: true, user: { select: { timezone: true } } },
    });
    revision = connection.revision;
    if (!connection.enabled) {
      return { claimed: true, succeeded: true };
    }
    const fence = { userId, leaseId, revision: connection.revision, enabled: true };
    if (!connection.mappings.length) {
      await prisma.homeAssistantConnection.updateMany({
        where: fence,
        data: { status: 'Choose health sensors to start syncing' },
      });
      return { claimed: true, succeeded: true };
    }
    const client = new HomeAssistantClient(
      connection.baseUrl,
      decryptToken(connection.encryptedToken, userId)
    );
    const context = {
      userId,
      leaseId,
      sourceNamespace: createHash('sha256').update(connection.baseUrl).digest('hex').slice(0, 24),
      revision: connection.revision,
      timezone: connection.user.timezone,
      mappings: connection.mappings,
    };
    // Lease renewal must not wait behind network history requests.
    heartbeat = setInterval(() => {
      heartbeatPending = heartbeatPending
        .then(async () => {
          const result = await prisma.homeAssistantConnection.updateMany({
            where: { ...fence, leaseExpiresAt: { gt: new Date() } },
            data: { leaseExpiresAt: new Date(Date.now() + 60000) },
          });
          if (!result.count) {
            throw new Error('Connection changed or lease expired.');
          }
        })
        .catch((error) => {
          failure = error;
          stop.abort();
        });
    }, 15000);
    listener = client
      .listen(
        connection.mappings.map((x) => x.entityId),
        (state) =>
          schedule(async () => {
            await importHealthStates(context, [state]);
          }),
        stop.signal
      )
      .catch((error) => {
        failure = error;
        stop.abort();
      });
    // Periodic snapshots also detect unavailable/missing entities and recover unchanged values.
    const reconcile = async () => {
      const states = await client.states();
      await importHealthStates(context, states);
      const mapped = connection.mappings.map((x) => states.find((s) => s.entity_id === x.entityId));
      const { normalizeMetric } = await import('@/lib/health/normalization');
      const invalid = mapped.filter(
        (state, i) =>
          !state || !normalizeMetric(connection.mappings[i].metric, state, context.timezone)
      ).length;
      await prisma.homeAssistantConnection.updateMany({
        where: fence,
        data: {
          lastSyncedAt: historyIncomplete ? connection.lastSyncedAt : new Date(),
          status: historyIncomplete
            ? 'Live sync active; history recovery unavailable'
            : invalid
              ? `${invalid} mapped sensor(s) missing, unavailable or unsupported`
              : 'Listening for changes',
        },
      });
    };
    schedule(async () => {
      const end = new Date();
      // Read bounded daily chunks; retain attributes because units are required for normalization.
      const earliest = end.getTime() - 7 * 86400000;
      const start = Math.max(earliest, (connection.lastSyncedAt?.getTime() ?? earliest) - 300000);

      for (let at = start; at < end.getTime() && !stop.signal.aborted; at += 86400000) {
        try {
          await importHealthStates(
            context,
            await client.history(
              connection.mappings.map((x) => x.entityId),
              new Date(at),
              new Date(Math.min(at + 86400000, end.getTime()))
            )
          );
        } catch (error) {
          if (!(error instanceof HomeAssistantError)) {
            throw error;
          }
          historyIncomplete = true;
          break;
        }
      }
      await reconcile();
      if (historyIncomplete) {
        await prisma.homeAssistantConnection.updateMany({
          where: fence,
          data: {
            status: 'Live sync active; history recovery unavailable',
            lastSyncedAt: connection.lastSyncedAt,
          },
        });
      }
    });
    reconcileTimer = setInterval(() => schedule(reconcile), 60000);
    // Bounded sessions reload credentials, mappings and timezone even without configuration events.
    endTimer = setTimeout(() => stop.abort(), 300000);
    await listener;
    await pending;
    if (failure) {
      throw failure instanceof Error ? failure : new Error('Sync interrupted.');
    }
    return { claimed: true, succeeded: true };
  } catch (error) {
    await prisma.homeAssistantConnection.updateMany({
      where: { userId, leaseId, revision },
      data: {
        status:
          error instanceof HomeAssistantError
            ? error.message
            : 'Sync interrupted. Check server configuration and restart the worker.',
      },
    });
    return { claimed: true, succeeded: false };
  } finally {
    stop.abort();
    if (heartbeat) {
      clearInterval(heartbeat);
    }
    if (reconcileTimer) {
      clearInterval(reconcileTimer);
    }
    if (endTimer) {
      clearTimeout(endTimer);
    }
    await listener;
    await pending;
    await heartbeatPending;
    signal.removeEventListener('abort', abort);
    // A late worker must never release another worker's lease.
    await prisma.$executeRaw(
      Prisma.sql`UPDATE home_assistant_connections SET "leaseId" = NULL, "leaseExpiresAt" = NULL WHERE "userId" = ${userId} AND "leaseId" = ${leaseId}::uuid`
    );
  }
}
