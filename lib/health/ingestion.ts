import 'server-only';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import { dateInTimezone, diaryDate, diaryDateSchema, shiftDiaryDate } from '@/lib/nutrition/dates';

const measurementSchema = z
  .object({
    metric: z.enum(['TOTAL_CALORIES', 'ACTIVE_CALORIES']),
    value: z.number().finite().min(0).max(100000),
    unit: z.literal('kcal'),
    date: diaryDateSchema,
    timezone: z
      .string()
      .max(100)
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, 'Use an IANA timezone.'),
    observedAt: z.iso.datetime(),
    periodStart: z.iso.datetime(),
    periodEnd: z.iso.datetime(),
    measurementKind: z.literal('sdk_aggregate_semantics_unverified'),
  })
  .strict()
  .superRefine((m, ctx) => {
    const start = new Date(m.periodStart);
    const end = new Date(m.periodEnd);
    const observed = new Date(m.observedAt);
    try {
      const midnight = (time: Date) =>
        new Intl.DateTimeFormat('en-GB', {
          timeZone: m.timezone,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23',
        }).format(time) === '00:00:00' && time.getUTCMilliseconds() === 0;
      if (
        !(start < end && end <= observed) ||
        observed.getTime() > Date.now() + 300000 ||
        dateInTimezone(m.timezone, start) !== m.date ||
        !midnight(start) ||
        !(
          dateInTimezone(m.timezone, end) === m.date ||
          (dateInTimezone(m.timezone, end) === shiftDiaryDate(m.date, 1) && midnight(end))
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          message:
            'Use local midnight through elapsed time or the next midnight, with a nonfuture capture time.',
        });
      }
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Invalid timezone or period.' });
    }
  });
export const healthUploadSchema = z
  .object({
    version: z.literal(1),
    source: z.literal('samsung_health'),
    measurements: z.array(measurementSchema).min(1).max(100),
  })
  .strict()
  .superRefine((input, ctx) => {
    const keys = input.measurements.map((m) => `${m.metric}:${m.date}`);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', message: 'Send each metric/date once per batch.' });
    }
  });

export async function ingestHealth(userId: string, credentialId: string, input: unknown) {
  const upload = healthUploadSchema.parse(input);
  return prisma.$transaction(async (db) => {
    // Serialize concurrent snapshots from all devices of this owner, before checking revision times.
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`health-upload:${userId}`}, 0))::text`;
    const results = [];
    for (const m of upload.measurements) {
      const sourceKey = `device:${credentialId}:${upload.source}:${m.metric}:${m.date}`;
      const where = { userId_sourceKey: { userId, sourceKey } };
      const existing = await db.healthMetric.findUnique({ where });
      const metadata = {
        timezone: m.timezone,
        periodStart: m.periodStart,
        periodEnd: m.periodEnd,
        measurementKind: m.measurementKind,
        credentialId,
        unit: m.unit,
      };
      const observedAt = new Date(m.observedAt);
      let status: 'created' | 'updated' | 'unchanged' | 'stale';
      if (existing && existing.observedAt >= observedAt) {
        if (existing.observedAt.getTime() === observedAt.getTime()) {
          const old = existing.metadata as Record<string, unknown>;
          if (
            Number(existing.value) !== Number(m.value.toFixed(6)) ||
            Object.entries(metadata).some(([key, value]) => old[key] !== value)
          ) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Capture timestamp already has different data. Read Samsung Health again.',
            });
          }
        }
        status = existing.observedAt > observedAt ? 'stale' : 'unchanged';
      } else {
        const data = {
          metric: m.metric,
          value: Number(m.value.toFixed(6)),
          date: diaryDate(m.date),
          observedAt,
          source: upload.source,
          sourceKey,
          timestampBasis: 'sdk_query_capture',
          metadata,
        };
        await db.healthMetric.upsert({
          where,
          create: { ...data, userId },
          update: { ...data, receivedAt: new Date() },
        });
        status = existing ? 'updated' : 'created';
      }
      results.push({ metric: m.metric, date: m.date, status });
    }
    return { version: 1, results };
  });
}
