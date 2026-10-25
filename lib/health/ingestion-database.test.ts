/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('superjson', () => ({ serialize: (v: unknown) => v, deserialize: (v: unknown) => v }));
jest.mock('@/lib/prisma', () => {
  const { PrismaClient } = jest.requireActual('@/generated/prisma/client');
  const { PrismaPg } = jest.requireActual('@prisma/adapter-pg');
  const testSchema = `health_upload_test_${require('node:crypto').randomBytes(8).toString('hex')}`;
  return {
    testSchema,
    prisma: new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: process.env.DATABASE_URL, options: `-c search_path=${testSchema}` },
        { schema: testSchema }
      ),
    }),
  };
});
jest.mock('@/lib/nutrition/history', () => ({ nutritionHistory: { get: jest.fn() } }));
import { readFileSync } from 'node:fs';
import { prisma } from '@/lib/prisma';
import { ingestHealth } from './ingestion';
import { healthService } from './service';
import { healthRouter } from './router';
import type { MetricKind } from './schema';
import { nutritionHistory } from '@/lib/nutrition/history';
const { testSchema } = jest.requireMock('@/lib/prisma');
const suite = process.env.VELA_HEALTH_DB_TESTS === '1' ? describe : describe.skip;
suite('health uploads on PostgreSQL', () => {
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${testSchema}"`);
    await prisma.$executeRawUnsafe('CREATE TABLE "user" (id TEXT PRIMARY KEY)');
    await prisma.$executeRawUnsafe(
      `CREATE TYPE "HealthMetricKind" AS ENUM ('WEIGHT', 'BODY_FAT', 'LEAN_MASS', 'SLEEP', 'TOTAL_CALORIES')`
    );
    await prisma.$executeRawUnsafe(`CREATE TABLE health_metrics (
      id UUID PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "user"(id), metric "HealthMetricKind" NOT NULL,
      value DECIMAL(20,6) NOT NULL, date DATE NOT NULL, "observedAt" TIMESTAMP NOT NULL,
      "receivedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, source VARCHAR(32) NOT NULL,
      "entityId" VARCHAR(240), "sourceKey" VARCHAR(500) NOT NULL, "timestampBasis" VARCHAR(32) NOT NULL,
      UNIQUE("userId", "sourceKey"))`);
    for (const sql of readFileSync(
      'prisma/migrations/20261024100000_android_health_ingestion/migration.sql',
      'utf8'
    )
      .split(';')
      .filter((s) => s.trim())) {
      await prisma.$executeRawUnsafe(sql);
    }
    await prisma.$executeRawUnsafe(
      `CREATE TABLE home_assistant_connections (revision INTEGER DEFAULT 1, status TEXT, "lastSyncedAt" TIMESTAMP)`
    );
    for (const sql of readFileSync(
      'prisma/migrations/20261024120000_companion_source_matrix/migration.sql',
      'utf8'
    )
      .split(';')
      .filter((s) => s.trim())) {
      await prisma.$executeRawUnsafe(sql);
    }
    await prisma.$executeRawUnsafe(`CREATE TABLE health_goals ("userId" TEXT PRIMARY KEY, "calorieBalance" INTEGER, version INTEGER DEFAULT 1,
      semantics JSONB DEFAULT '{}', "metricGoals" JSONB DEFAULT '{}', "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await prisma.$executeRawUnsafe(`INSERT INTO "user" VALUES ('alice'), ('bob')`);
  });
  afterAll(async () => {
    try {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
    } finally {
      await prisma.$disconnect();
    }
  });
  it('serializes retries/corrections, isolates owners and selects one authoritative series', async () => {
    const measurement = {
      metric: 'TOTAL_CALORIES',
      value: 2400.12345678,
      unit: 'kcal',
      date: '2026-03-29',
      timezone: 'Europe/Amsterdam',
      observedAt: '2026-03-30T10:00:00Z',
      periodStart: '2026-03-28T23:00:00Z',
      periodEnd: '2026-03-29T22:00:00Z',
      measurementKind: 'sdk_aggregate_semantics_unverified',
    };
    const payload = { version: 1, source: 'samsung_health', measurements: [measurement] };
    const results = await Promise.all([
      ingestHealth('alice', 'phone', payload),
      ingestHealth('alice', 'phone', payload),
    ]);
    expect(results.map((r) => r.results[0].status).sort()).toEqual(['created', 'unchanged']);
    await ingestHealth('bob', 'other-phone', payload);
    const corrected = {
      ...payload,
      measurements: [{ ...measurement, value: 2300, observedAt: '2026-03-30T11:00:00Z' }],
    };
    await Promise.all([
      ingestHealth('alice', 'phone', corrected),
      ingestHealth('alice', 'phone', payload),
    ]);
    expect(await prisma.healthMetric.count({ where: { userId: 'alice' } })).toBe(1);
    expect(
      Number((await prisma.healthMetric.findFirstOrThrow({ where: { userId: 'alice' } })).value)
    ).toBe(2300);
    const original = await prisma.healthMetric.findFirstOrThrow({ where: { userId: 'alice' } });
    await prisma.healthMetric.create({
      data: {
        ...original,
        metadata: {},
        id: '00000000-0000-4000-8000-000000000001',
        sourceKey: 'ha:total',
        source: 'home_assistant',
        value: 3000,
        observedAt: new Date('2026-03-30T12:00:00Z'),
      },
    });
    await ingestHealth('alice', 'phone', {
      ...payload,
      measurements: [{ ...measurement, metric: 'ACTIVE_CALORIES', value: 400 }],
    });
    (nutritionHistory.get as jest.Mock).mockResolvedValue({
      startDate: '2026-03-29',
      days: [{ date: '2026-03-29', nutrients: { calories: '2000' } }],
    });
    const day = (await healthService.history('alice', { endDate: '2026-03-29', days: 7 })).days[0];
    expect(day.burned).toBe(2300);
    expect(day.balance).toBe(-300);
    expect(day.metrics.ACTIVE_CALORIES?.value).toBe(400);
    expect(day.metrics.TOTAL_CALORIES?.source).toBe('samsung_health');
    await prisma.healthMetric.create({
      data: {
        ...original,
        metadata: {},
        id: '00000000-0000-4000-8000-000000000002',
        sourceKey: 'manual:total',
        source: 'manual',
        value: 2200,
      },
    });
    expect(
      (await healthService.history('alice', { endDate: '2026-03-29', days: 7 })).days[0].burned
    ).toBe(2300);
  });
  it('stores the expanded matrix idempotently and retains BMR across missing days without adding it to burn', async () => {
    const base = {
      date: '2025-10-26',
      timezone: 'Europe/Amsterdam',
      observedAt: '2025-10-27T10:00:00Z',
      periodStart: '2025-10-25T22:00:00Z',
      periodEnd: '2025-10-26T23:00:00Z',
    };
    const measurements = [
      {
        ...base,
        metric: 'TOTAL_CALORIES',
        value: 2400,
        unit: 'kcal',
        measurementKind: 'sdk_aggregate_semantics_unverified',
      },
      {
        ...base,
        metric: 'ACTIVE_CALORIES',
        value: 400,
        unit: 'kcal',
        measurementKind: 'sdk_aggregate_semantics_unverified',
      },
      { ...base, metric: 'STEPS', value: 12345, unit: 'steps', measurementKind: 'sdk_steps_total' },
      {
        ...base,
        metric: 'SLEEP',
        value: 8.5,
        unit: 'hours',
        measurementKind: 'sdk_sleep_date_total',
      },
      {
        ...base,
        metric: 'BMR',
        value: 1700,
        unit: 'kcal/day',
        measurementKind: 'sdk_bmr_point',
        periodStart: '2025-10-26T09:00:00Z',
        periodEnd: '2025-10-26T09:00:00Z',
        sourceObservedAt: '2025-10-26T09:00:00Z',
        sourceModifiedAt: '2025-10-26T09:01:00Z',
        upstreamId: 'bmr-point',
      },
    ];
    const payload = { version: 1, source: 'samsung_health', measurements };
    await Promise.all([
      ingestHealth('alice', 'phone', payload),
      ingestHealth('alice', 'phone', payload),
    ]);
    expect(
      await prisma.healthMetric.count({ where: { userId: 'alice', date: new Date('2025-10-26') } })
    ).toBe(5);
    const sleep = await prisma.healthMetric.findFirstOrThrow({
      where: { userId: 'alice', metric: 'SLEEP', date: new Date('2025-10-26') },
    });
    await prisma.healthMetric.create({
      data: {
        ...sleep,
        metadata: {},
        id: '00000000-0000-4000-8000-000000000099',
        sourceKey: 'legacy-ha-sleep',
        source: 'home_assistant',
        value: 9,
        observedAt: new Date('2025-10-28T12:00:00Z'),
      },
    });
    await ingestHealth('alice', 'phone', {
      ...payload,
      measurements: [
        { ...measurements[2], value: 12000, observedAt: '2025-10-28T12:00:00Z' },
        { ...measurements[3], value: 8, observedAt: '2025-10-28T12:00:00Z' },
      ],
    });
    (nutritionHistory.get as jest.Mock).mockResolvedValue({
      startDate: '2025-10-26',
      days: [
        { date: '2025-10-26', nutrients: { calories: '2000' } },
        { date: '2025-10-27', nutrients: null },
      ],
    });
    const days = (await healthService.history('alice', { endDate: '2025-10-27', days: 7 })).days;
    expect(days[0].metrics.STEPS?.value).toBe(12000);
    expect(days[0].metrics.SLEEP).toMatchObject({ value: 8, source: 'samsung_health' });
    expect(days[0].burned).toBe(2400);
    expect(days[0].balance).toBe(-400);
    expect(days[1].metrics.BMR).toMatchObject({
      value: 1700,
      carriedForward: true,
      measurementDate: '2025-10-26',
    });
    expect(days[1].metrics.SLEEP).toBeNull();
    expect(days[1].metrics.STEPS).toBeNull();
    expect(await prisma.healthMetric.count({ where: { sourceKey: 'legacy-ha-sleep' } })).toBe(1);
    const bmr = await prisma.healthMetric.findFirstOrThrow({
      where: { userId: 'alice', metric: 'BMR' },
    });
    await prisma.healthMetric.create({
      data: {
        ...bmr,
        metadata: {},
        id: '00000000-0000-4000-8000-000000000098',
        source: 'manual',
        sourceKey: 'manual-bmr-fallback',
        value: 1800,
        observedAt: new Date('2025-10-29T10:00:00Z'),
      },
    });
    (nutritionHistory.get as jest.Mock).mockResolvedValue({
      startDate: '2025-11-01',
      days: [{ date: '2025-11-01', nutrients: null }],
    });
    const carried = (await healthService.history('alice', { endDate: '2025-11-07', days: 7 }))
      .days[0].metrics.BMR;
    expect(carried).toMatchObject({ value: 1700, carriedForward: true, source: 'samsung_health' });
  });

  it('returns the complete source matrix through tRPC and keeps today missing after a successful historical sync', async () => {
    const base = {
      date: '2026-10-24',
      timezone: 'Europe/Amsterdam',
      observedAt: '2026-10-24T22:30:00Z',
      periodStart: '2026-10-23T22:00:00Z',
      periodEnd: '2026-10-24T22:00:00Z',
    };
    const measurements = [
      {
        ...base,
        metric: 'TOTAL_CALORIES',
        value: 2400,
        unit: 'kcal',
        measurementKind: 'sdk_aggregate_semantics_unverified',
      },
      {
        ...base,
        metric: 'ACTIVE_CALORIES',
        value: 400,
        unit: 'kcal',
        measurementKind: 'sdk_aggregate_semantics_unverified',
      },
      { ...base, metric: 'STEPS', value: 9000, unit: 'steps', measurementKind: 'sdk_steps_total' },
      {
        ...base,
        metric: 'SLEEP',
        value: 8,
        unit: 'hours',
        measurementKind: 'sdk_sleep_date_total',
      },
      {
        ...base,
        metric: 'BMR',
        value: 1900,
        unit: 'kcal/day',
        measurementKind: 'sdk_bmr_point',
        date: '2026-05-30',
        periodStart: '2026-05-30T08:00:00Z',
        periodEnd: '2026-05-30T08:00:00Z',
        sourceObservedAt: '2026-05-30T08:00:00Z',
        upstreamId: 'matrix-bmr',
      },
    ];
    const receipt = await ingestHealth('alice', 'matrix-phone', {
      version: 1,
      source: 'samsung_health',
      measurements,
    });
    expect(receipt.results).toHaveLength(5);
    expect(receipt.results.every((r) => r.status === 'created')).toBe(true);
    const body = { WEIGHT: 80, BODY_FAT: 20, LEAN_MASS: 64 } as const;
    for (const [metric, value] of Object.entries(body)) {
      for (const source of ['home_assistant', 'manual', 'samsung_health']) {
        await prisma.healthMetric.create({
          data: {
            userId: 'alice',
            metric: metric as keyof typeof body,
            value: source === 'home_assistant' ? value : value + 1,
            date: new Date(base.date),
            observedAt: new Date(
              source === 'home_assistant' ? base.observedAt : '2026-10-25T00:00:00Z'
            ),
            source,
            sourceKey: `matrix:${source}:${metric}`,
            timestampBasis: 'sensor_state',
          },
        });
      }
    }
    for (const m of measurements) {
      for (const source of ['manual', 'home_assistant']) {
        await prisma.healthMetric.create({
          data: {
            userId: 'alice',
            metric: m.metric as MetricKind,
            value: m.value + 1,
            date: new Date(m.date),
            observedAt: new Date('2026-10-25T00:00:00Z'),
            source,
            sourceKey: `matrix:${source}:${m.metric}`,
            timestampBasis: 'user_date',
          },
        });
      }
    }
    await ingestHealth('bob', 'matrix-phone', {
      version: 1,
      source: 'samsung_health',
      measurements: [{ ...measurements[0], value: 9999 }],
    });
    const count = await prisma.healthMetric.count();
    const caller = healthRouter.createCaller({ userId: 'alice' });
    (nutritionHistory.get as jest.Mock).mockResolvedValue({
      startDate: '2026-10-19',
      days: [
        { date: '2026-10-24', nutrients: { calories: '2000' } },
        { date: '2026-10-25', nutrients: null },
      ],
    });
    const { days } = await caller.history({ endDate: '2026-10-25', days: 7 });
    for (const [metric, value] of Object.entries(body)) {
      expect(days[0].metrics[metric as keyof typeof body]).toMatchObject({
        value,
        source: 'home_assistant',
      });
    }
    for (const m of measurements) {
      expect(days[0].metrics[m.metric as MetricKind]).toMatchObject({
        value: m.value,
        source: 'samsung_health',
      });
    }
    expect(days[0]).toMatchObject({ burned: 2400, balance: -400 });
    expect(days[1]).toMatchObject({ burned: null, balance: null });
    for (const metric of ['TOTAL_CALORIES', 'ACTIVE_CALORIES', 'STEPS', 'SLEEP'] as const) {
      expect(days[1].metrics[metric]).toBeNull();
    }
    expect(days[1].metrics.BMR).toMatchObject({
      value: 1900,
      source: 'samsung_health',
      measurementDate: '2026-05-30',
      carriedForward: true,
    });
    // The same priority applies to body measurements carried from before the window.
    (nutritionHistory.get as jest.Mock).mockResolvedValue({
      startDate: '2026-10-25',
      days: [{ date: '2026-10-25', nutrients: null }],
    });
    const carried = (await caller.history({ endDate: '2026-10-31', days: 7 })).days[0];
    for (const [metric, value] of Object.entries(body)) {
      expect(carried.metrics[metric as keyof typeof body]).toMatchObject({
        value,
        source: 'home_assistant',
        carriedForward: true,
      });
    }
    // Owner isolation and genuinely absent BMR; no calculated point or extra health rows.
    const other = (
      await healthRouter.createCaller({ userId: 'bob' }).history({ endDate: '2026-10-31', days: 7 })
    ).days[0];
    expect(other.metrics.BMR).toBeNull();
    expect(await prisma.healthMetric.count()).toBe(count);
    await expect(
      healthRouter.createCaller({ userId: null }).history({ endDate: '2026-10-25', days: 7 })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
