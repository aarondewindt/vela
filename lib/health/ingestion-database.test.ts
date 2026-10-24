/** @jest-environment node */
jest.mock('server-only', () => ({}));
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
    ).toBe(2200);
  });
});
