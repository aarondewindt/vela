import 'server-only';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import { rateLimit } from '@/lib/devices/service';
import { diagnosticUploadSchema, type HistoryFilter } from './schema';

export const retentionDate = () => new Date(Date.now() - 30 * 86400_000);
const device = { select: { id: true, name: true } } as const;
export function errorCategory(error: unknown) {
  return error instanceof TRPCError
    ? error.code
    : error instanceof z.ZodError
      ? 'BAD_REQUEST'
      : 'INTERNAL_SERVER_ERROR';
}
// Called on writes and reads, and available to a scheduled maintenance command. Reads always
// exclude expired data even if this cleanup has not run during a quiet period.
export async function pruneCompanion(userId?: string) {
  await prisma.companionUpload.deleteMany({
    where: { userId, receivedAt: { lt: retentionDate() } },
  });
  await prisma.companionEvent.deleteMany({
    where: { userId, receivedAt: { lt: retentionDate() } },
  });
}
export async function saveDiagnostics(userId: string, deviceId: string, input: unknown) {
  const snapshot = diagnosticUploadSchema.parse(input);
  await rateLimit(`diagnostics:${deviceId}`, 2);
  await pruneCompanion(userId);
  return prisma.$transaction(async (db) => {
    // Serialize the cap across concurrent uploads from this device.
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`diagnostics:${deviceId}`}, 0))::text`;
    const upload = await db.companionUpload.create({
      data: {
        userId,
        deviceId,
        version: snapshot.version,
        appVersion: snapshot.appVersion,
        report: { capturedAt: snapshot.capturedAt, ...snapshot.diagnostic },
        events: {
          create: snapshot.attempts.map((a) => ({
            userId,
            deviceId,
            kind: 'attempt',
            occurredAt: new Date(a.createdAt),
            attemptId: a.id,
            trigger: a.trigger,
            status: a.status,
            source: a.source,
            count: a.readings,
            metrics: a.metrics,
            dateFrom: a.dateFrom,
            dateTo: a.dateTo,
            durationMs: a.durationMs,
            retry: a.retry,
            replay: a.requests.some((r) => r.replay),
            batchId: a.requests.find((r) => r.batchId)?.batchId,
            errorCategory: a.error?.category,
            detail: a,
          })),
        },
      },
    });
    const overflow = await db.companionUpload.findMany({
      where: { userId, deviceId },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      skip: 60,
      select: { id: true },
    });
    if (overflow.length) {
      await db.companionUpload.deleteMany({
        where: { userId, id: { in: overflow.map((v) => v.id) } },
      });
    }
    return { version: 1, id: upload.id, receivedAt: upload.receivedAt };
  });
}
export async function listEvents(userId: string, input: HistoryFilter) {
  await pruneCompanion(userId);
  const where: Prisma.CompanionEventWhereInput = {
    userId,
    kind: input.kind,
    deviceId: input.deviceId,
    trigger: input.trigger,
    status: input.status,
    source: input.source,
    receivedAt: { gte: retentionDate() },
    occurredAt: {
      ...(input.from ? { gte: new Date(input.from) } : {}),
      ...(input.to ? { lt: new Date(Date.parse(input.to) + 86400_000) } : {}),
    },
    ...(input.cursor
      ? {
          OR: [
            { occurredAt: { lt: new Date(input.cursor.at) } },
            { occurredAt: new Date(input.cursor.at), id: { lt: input.cursor.id } },
          ],
        }
      : {}),
  };
  const rows = await prisma.companionEvent.findMany({
    where,
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
    select: {
      id: true,
      device,
      uploadId: true,
      kind: true,
      occurredAt: true,
      receivedAt: true,
      attemptId: true,
      batchId: true,
      trigger: true,
      status: true,
      count: true,
      metrics: true,
      dateFrom: true,
      dateTo: true,
      durationMs: true,
      retry: true,
      replay: true,
      errorCategory: true,
    },
  });
  const more = rows.length > input.limit;
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return { items, next: more && last ? { at: last.occurredAt.toISOString(), id: last.id } : null };
}
export async function eventDetail(userId: string, id: string) {
  const row = await prisma.companionEvent.findFirst({
    where: { id, userId, receivedAt: { gte: retentionDate() } },
    include: { device },
  });
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  // Correlation is observational, scoped to owner and device. Multiple requests/replays may match.
  const related = await prisma.companionEvent.findMany({
    where: {
      userId,
      deviceId: row.deviceId,
      id: { not: id },
      receivedAt: { gte: retentionDate() },
      OR: [
        ...(row.attemptId ? [{ attemptId: row.attemptId }] : []),
        ...(row.batchId ? [{ batchId: row.batchId }] : []),
      ],
    },
    orderBy: { receivedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      kind: true,
      status: true,
      receivedAt: true,
      attemptId: true,
      batchId: true,
    },
  });
  return { ...row, related };
}
export async function listUploads(
  userId: string,
  input: { deviceId?: string; cursor?: string; limit: number; from?: string; to?: string }
) {
  await pruneCompanion(userId);
  const items = await prisma.companionUpload.findMany({
    where: {
      userId,
      deviceId: input.deviceId,
      receivedAt: {
        gte: input.from
          ? new Date(Math.max(Date.parse(input.from), retentionDate().getTime()))
          : retentionDate(),
        ...(input.to ? { lt: new Date(Date.parse(input.to) + 86400_000) } : {}),
      },
    },
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
    select: {
      id: true,
      receivedAt: true,
      appVersion: true,
      version: true,
      device,
      _count: { select: { events: true } },
    },
  });
  // A cursor must belong to this owner, even though Prisma's cursor is not itself returned.
  if (
    input.cursor &&
    !(await prisma.companionUpload.findFirst({
      where: {
        id: input.cursor,
        userId,
        deviceId: input.deviceId,
        receivedAt: { gte: retentionDate() },
      },
    }))
  ) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  const more = items.length > input.limit;
  return { items: items.slice(0, input.limit), next: more ? items[input.limit - 1].id : null };
}
export async function uploadDetail(userId: string, id: string) {
  const row = await prisma.companionUpload.findFirst({
    where: { id, userId, receivedAt: { gte: retentionDate() } },
    include: { device, events: { orderBy: { occurredAt: 'desc' } } },
  });
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  return row;
}
export async function deviceOverview(userId: string) {
  const devices = await prisma.deviceCredential.findMany({
    where: { userId },
    select: { id: true, name: true, revokedAt: true },
  });
  return Promise.all(
    devices.map(async (d) => ({
      ...d,
      lastUpload: await prisma.companionUpload.findFirst({
        where: { userId, deviceId: d.id, receivedAt: { gte: retentionDate() } },
        orderBy: { receivedAt: 'desc' },
        select: { receivedAt: true, appVersion: true },
      }),
      lastReported: await prisma.companionEvent.findFirst({
        where: { userId, deviceId: d.id, kind: 'attempt', receivedAt: { gte: retentionDate() } },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true, status: true },
      }),
      lastReportedSuccess: await prisma.companionEvent.findFirst({
        where: {
          userId,
          deviceId: d.id,
          kind: 'attempt',
          status: 'success',
          receivedAt: { gte: retentionDate() },
        },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true },
      }),
    }))
  );
}
