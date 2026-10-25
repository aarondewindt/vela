import { z } from 'zod';

// Only app-generated structured diagnostics are accepted, never headers or logcat dumps.
export function redact(value: string) {
  return (
    value
      .replace(/vela_device_[A-Za-z0-9_-]+/gi, '[redacted]')
      .replace(/\bBearer\s+\S+/gi, '[redacted]')
      .replace(
        /\b(authorization|cookie|password|token|secret|credential)\s*[:=]\s*[^\s,;]+/gi,
        '$1=[redacted]'
      )
      // Control characters are deliberately removed from untrusted report text.
      // oxlint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  );
}
const text = (max: number) => z.string().max(max).transform(redact);
const instant = z.iso
  .datetime()
  .refine((v) => Date.parse(v) <= Date.now() + 300_000, 'Future timestamp.');
export const triggerSchema = z.enum(['manual', 'automatic', 'unknown']);
export const outcomeSchema = z.enum([
  'running',
  'success',
  'no_data',
  'partial',
  'failed',
  'cancelled',
  'paused',
  'interrupted',
]);
export const categorySchema = z.enum([
  'permission',
  'availability',
  'authorization',
  'query',
  'network',
  'http',
  'receipt',
  'storage',
  'cancelled',
  'unknown',
]);
const metric = z.enum(['TOTAL_CALORIES', 'ACTIVE_CALORIES', 'STEPS', 'SLEEP', 'BMR']);
const querySchema = z
  .object({
    metric: text(80),
    date: z.iso.date().optional(),
    start: text(80).optional(),
    end: text(80).optional(),
    at: instant,
    endedAt: instant.optional(),
    rows: z.number().int().min(0).max(10000).optional(),
    value: z.number().finite().optional(),
    error: categorySchema.optional(),
  })
  .strict();
export const attemptSchema = z
  .object({
    id: z.uuid(),
    trigger: triggerSchema,
    createdAt: instant,
    startedAt: instant.optional(),
    endedAt: instant.optional(),
    durationMs: z.number().int().min(0).max(2147483647).optional(),
    timezone: text(100),
    status: outcomeSchema,
    source: z.literal('samsung_health'),
    appVersion: text(80),
    os: text(160),
    provider: text(300),
    workId: z.uuid().optional(),
    workStopReason: z.number().int().min(-2147483648).max(2147483647).optional(),
    retry: z.number().int().min(0).max(100).optional(),
    stages: z.array(z.object({ name: text(80), at: instant }).strict()).max(100),
    queries: z.array(querySchema).max(150),
    readings: z.number().int().min(0).max(100).optional(),
    metrics: z.array(metric).max(5),
    dateFrom: z.iso.date().optional(),
    dateTo: z.iso.date().optional(),
    requests: z
      .array(
        z
          .object({
            path: z.enum(['verify', 'ingest']),
            at: instant,
            endedAt: instant.optional(),
            batchId: z.uuid().optional(),
            replay: z.boolean().optional(),
            rows: z.number().int().min(0).max(100).optional(),
            status: z.number().int().min(100).max(599).optional(),
            error: categorySchema.optional(),
            receipt: z
              .array(
                z
                  .object({
                    metric,
                    date: z.iso.date(),
                    status: z.enum(['created', 'updated', 'unchanged', 'stale']),
                  })
                  .strict()
              )
              .max(100)
              .optional(),
          })
          .strict()
      )
      .max(4),
    error: z
      .object({ category: categorySchema, detail: text(500), sdkCode: text(100).optional() })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (
      (a.startedAt && Date.parse(a.startedAt) < Date.parse(a.createdAt)) ||
      (a.endedAt && Date.parse(a.endedAt) < Date.parse(a.startedAt ?? a.createdAt))
    ) {
      ctx.addIssue({ code: 'custom', message: 'Attempt timestamps are out of order.' });
    }
  });
export const diagnosticUploadSchema = z
  .object({
    version: z.literal(1),
    appVersion: text(80),
    capturedAt: instant,
    diagnostic: z
      .object({
        source: text(300),
        environment: text(500),
        report: text(32000).nullable(),
        reportAvailable: z.boolean(),
        permission: text(160),
        pending: z.boolean(),
        paused: z.boolean(),
        historyAvailable: z.boolean(),
        background: z
          .object({
            intervalMinutes: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(120)]),
            workAvailable: z.boolean(),
            powerSaveMode: z.boolean(),
            batteryOptimizationIgnored: z.boolean(),
            backgroundRestricted: z.boolean(),
            interactive: z.boolean(),
            networkValidated: z.boolean(),
            batteryPercent: z.number().int().min(0).max(100).optional(),
            work: z
              .array(
                z
                  .object({
                    id: z.uuid(),
                    state: z.enum(['ENQUEUED', 'RUNNING', 'BLOCKED']),
                    runAttemptCount: z.number().int().min(0),
                    generation: z.number().int().min(0),
                    stopReason: z.number().int().min(-2147483648).max(2147483647),
                    // A future eligibility time is expected, unlike observed event timestamps.
                    nextScheduleAt: z.iso.datetime().optional(),
                  })
                  .strict()
              )
              .max(5),
          })
          .strict()
          .optional(),
      })
      .strict()
      .refine(
        (d) => d.reportAvailable === (d.report !== null),
        'Report availability must match report.'
      ),
    attempts: z.array(attemptSchema).max(100),
  })
  .strict();
export const historyFilterSchema = z
  .object({
    kind: z.enum(['ingestion', 'attempt']).default('ingestion'),
    deviceId: z.uuid().optional(),
    trigger: triggerSchema.optional(),
    status: z
      .enum([
        'received',
        'success',
        'failed',
        'running',
        'no_data',
        'partial',
        'cancelled',
        'paused',
        'interrupted',
      ])
      .optional(),
    source: z.enum(['samsung_health', 'unknown']).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    cursor: z.object({ at: z.iso.datetime(), id: z.uuid() }).optional(),
    limit: z.number().int().min(1).max(50).default(25),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Choose an ordered date range.');
export type HistoryFilter = z.infer<typeof historyFilterSchema>;

export const uploadFilterSchema = z
  .object({
    deviceId: z.uuid().optional(),
    cursor: z.uuid().optional(),
    limit: z.number().int().min(1).max(50).default(25),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Choose an ordered date range.');
