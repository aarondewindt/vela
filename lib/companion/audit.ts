import 'server-only';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import { boundedJson } from '@/lib/devices/http';
import { requireDevice } from '@/lib/devices/service';
import { healthUploadSchema, ingestHealth } from '@/lib/health/ingestion';
import { redact } from './schema';
import { Prisma } from '@/generated/prisma/client';
import { errorCategory, pruneCompanion } from './service';

const uuid = (v: unknown) => z.uuid().safeParse(v).data;
export async function auditedIngestion(request: Request) {
  const started = Date.now();
  // Authenticate identity first so missing health scope can be audited too. Invalid/revoked
  // credentials only increment requireDevice's fixed-cardinality global rate-limit counter.
  const device = await requireDevice(request.headers, []);
  await pruneCompanion(device.userId);
  const audit = await prisma.companionEvent.create({
    data: {
      userId: device.userId,
      deviceId: device.credentialId,
      kind: 'ingestion',
      receivedAt: new Date(started),
      occurredAt: new Date(started),
      status: 'received',
      source: 'unknown',
      metrics: [],
    },
  });
  let metadata: {
    source?: string;
    attemptId?: string;
    trigger?: string;
    retry?: number;
    replay?: boolean;
    batchId?: string;
    count?: number;
    metrics?: string[];
    dateFrom?: string;
    dateTo?: string;
  } = {
    attemptId: uuid(request.headers.get('x-vela-attempt-id')),
    trigger: z.enum(['manual', 'automatic']).safeParse(request.headers.get('x-vela-trigger')).data,
  };
  let safeRequest: Prisma.InputJsonValue | undefined;
  const safeJson = (value: unknown): Prisma.InputJsonValue =>
    JSON.parse(JSON.stringify(value), (_key, v) => (typeof v === 'string' ? redact(v) : v));
  try {
    // Bound authenticated audit storage too; this never touches health rows or receipts.
    const overflow = await prisma.companionEvent.findMany({
      where: { userId: device.userId, deviceId: device.credentialId, kind: 'ingestion' },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      skip: 2000,
      take: 100,
      select: { id: true },
    });
    if (overflow.length) {
      await prisma.companionEvent.deleteMany({
        where: { userId: device.userId, id: { in: overflow.map((r) => r.id) } },
      });
    }
    if (!device.scopes.includes('health:write')) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    const raw = await boundedJson(request, 65536);
    const parsed = healthUploadSchema.safeParse(raw);
    // On invalid payloads keep only validated correlation identifiers, never rejected raw data.
    const attemptId = uuid(request.headers.get('x-vela-attempt-id')) ?? uuid(raw?.attemptId);
    const batchId = uuid(raw?.batchId);
    metadata = { ...metadata, attemptId, batchId };
    if (!parsed.success) {
      throw parsed.error;
    }
    const payload = parsed.data;
    const dates = payload.measurements.map((m) => m.date).sort();
    const retry = z.coerce
      .number()
      .int()
      .min(0)
      .max(100)
      .safeParse(request.headers.get('x-vela-retry') ?? undefined).data;
    const trigger =
      z.enum(['manual', 'automatic']).safeParse(request.headers.get('x-vela-trigger')).data ??
      payload.trigger ??
      'unknown';
    metadata = {
      ...metadata,
      trigger,
      retry,
      replay: z.enum(['true', 'false']).safeParse(request.headers.get('x-vela-replay')).success
        ? request.headers.get('x-vela-replay') === 'true'
        : undefined,
      source: payload.source,
      count: payload.measurements.length,
      metrics: [...new Set(payload.measurements.map((m) => m.metric))],
      dateFrom: dates[0],
      dateTo: dates.at(-1),
    };
    safeRequest = safeJson(payload);
    await prisma.companionEvent.update({
      where: { id: audit.id },
      data: { ...metadata, detail: { request: safeRequest } },
    });
    const result = await ingestHealth(device.userId, device.credentialId, payload);
    await prisma.companionEvent.update({
      where: { id: audit.id },
      data: {
        status: 'success',
        durationMs: Math.max(0, Math.min(Date.now() - started, 2147483647)),
        detail: { request: safeRequest, receipt: result, httpStatus: 200 },
      },
    });
    return result;
  } catch (error) {
    await prisma.companionEvent.update({
      where: { id: audit.id },
      data: {
        ...metadata,
        status: 'failed',
        durationMs: Math.max(0, Math.min(Date.now() - started, 2147483647)),
        errorCategory: errorCategory(error),
        detail: {
          ...(safeRequest ? { request: safeRequest } : {}),
          error: {
            category: errorCategory(error),
            detail:
              error instanceof z.ZodError
                ? 'Payload validation failed.'
                : 'Ingestion request failed.',
            ...(error instanceof z.ZodError
              ? {
                  issues: error.issues.slice(0, 20).map((i) => ({
                    code: i.code,
                    path: i.path.map((part) =>
                      typeof part === 'string' ? redact(part).slice(0, 80) : String(part)
                    ),
                  })),
                }
              : {}),
          },
        },
      },
    });
    throw error;
  }
}
