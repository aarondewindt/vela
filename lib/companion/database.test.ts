/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => {
  const { PrismaClient } = jest.requireActual('@/generated/prisma/client');
  const { PrismaPg } = jest.requireActual('@prisma/adapter-pg');
  const testSchema = `companion_test_${require('node:crypto').randomBytes(8).toString('hex')}`;
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
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { hashSecret } from '@/lib/devices/service';
import { POST as ingest } from '@/app/api/health/ingest/route';
import { POST as upload } from '@/app/api/devices/diagnostics/route';
import {
  deviceOverview,
  eventDetail,
  listEvents,
  listUploads,
  pruneCompanion,
  saveDiagnostics,
  uploadDetail,
} from './service';
import { historyFilterSchema } from './schema';
import { healthFixture, snapshotFixture, attemptFixture } from './fixtures';
const { testSchema } = jest.requireMock('@/lib/prisma');
const suite = process.env.VELA_COMPANION_DB_TESTS === '1' ? describe : describe.skip;
const token = `vela_device_${'a'.repeat(43)}`;
const phone = randomUUID();
const otherPhone = randomUUID();
const request = (path: string, body: unknown, credential = token, headers = {}) =>
  new Request(`https://vela.test${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${credential}`,
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
suite('persisted companion diagnostics on isolated PostgreSQL tables', () => {
  beforeAll(async () => {
    process.env.BETTER_AUTH_URL = 'https://vela.test';
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${testSchema}"`);
    await prisma.$executeRawUnsafe('CREATE TABLE "user" (id TEXT PRIMARY KEY)');
    for (const migration of [
      '20261024000000_device_credentials',
      '20261024220000_companion_diagnostics',
      '20261024223000_companion_unknown_counts',
    ]) {
      for (const sql of readFileSync(`prisma/migrations/${migration}/migration.sql`, 'utf8')
        .split(';')
        .filter((v) => v.trim())) {
        await prisma.$executeRawUnsafe(sql);
      }
    }
    await prisma.$executeRawUnsafe(
      `CREATE TYPE "HealthMetricKind" AS ENUM ('STEPS','SLEEP','BMR','TOTAL_CALORIES','ACTIVE_CALORIES')`
    );
    await prisma.$executeRawUnsafe(
      `CREATE TABLE health_metrics (id UUID PRIMARY KEY,"userId" TEXT NOT NULL REFERENCES "user"(id),metric "HealthMetricKind" NOT NULL,value DECIMAL(20,6) NOT NULL,date DATE NOT NULL,"observedAt" TIMESTAMP NOT NULL,"receivedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,source VARCHAR(32) NOT NULL,"entityId" VARCHAR(240),"sourceKey" VARCHAR(500) NOT NULL,"timestampBasis" VARCHAR(32) NOT NULL,metadata JSONB NOT NULL DEFAULT '{}', UNIQUE("userId","sourceKey"))`
    );
    await prisma.$executeRawUnsafe(`INSERT INTO "user" VALUES ('alice'),('bob')`);
    await prisma.deviceCredential.createMany({
      data: [
        {
          id: phone,
          userId: 'alice',
          name: 'Synthetic phone',
          clientType: 'android',
          tokenHash: hashSecret(token),
          scopes: ['health:write'],
        },
        {
          id: otherPhone,
          userId: 'bob',
          name: 'Other phone',
          clientType: 'android',
          tokenHash: hashSecret(`vela_device_${'b'.repeat(43)}`),
          scopes: ['health:write'],
        },
      ],
    });
  });
  afterAll(async () => {
    try {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
    } finally {
      await prisma.$disconnect();
    }
  });
  it('records duplicate deliveries separately while keeping one health row and accurate receipts', async () => {
    const batchId = randomUUID(),
      attemptId = randomUUID();
    const body = { ...healthFixture, batchId, attemptId, trigger: 'manual' };
    const first = await ingest(request('/api/health/ingest', body));
    expect(first.status).toBe(200);
    const replayId = randomUUID();
    const replay = await ingest(
      request('/api/health/ingest', body, token, {
        'x-vela-attempt-id': replayId,
        'x-vela-trigger': 'automatic',
        'x-vela-retry': '2',
        'x-vela-replay': 'true',
      })
    );
    expect(replay.status).toBe(200);
    expect((await replay.json()).results[0].status).toBe('unchanged');
    expect(await prisma.healthMetric.count()).toBe(1);
    const audit = await prisma.companionEvent.findMany({
      where: { userId: 'alice', batchId },
      orderBy: { receivedAt: 'asc' },
    });
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({
      attemptId: replayId,
      batchId,
      trigger: 'automatic',
      retry: 2,
      replay: true,
      count: 1,
      status: 'success',
    });
    expect(audit[1].detail).toMatchObject({
      receipt: { results: [{ status: 'unchanged' }] },
      request: { measurements: [{ value: 1234, unit: 'steps' }] },
    });
    expect((await eventDetail('alice', audit[0].id)).related.map((r) => r.id)).toContain(
      audit[1].id
    );
  });
  it('persists rolled-back conflicts, invalid input, missing scope and server failures without raw secrets', async () => {
    const conflict = {
      ...healthFixture,
      measurements: [{ ...healthFixture.measurements[0], value: 999 }],
    };
    expect((await ingest(request('/api/health/ingest', conflict))).status).toBe(409);
    expect(Number((await prisma.healthMetric.findFirstOrThrow()).value)).toBe(1234);
    expect(
      (await ingest(request('/api/health/ingest', { token: 'do-not-store-secret' }))).status
    ).toBe(400);
    await prisma.deviceCredential.update({ where: { id: phone }, data: { scopes: [] } });
    expect((await ingest(request('/api/health/ingest', healthFixture))).status).toBe(403);
    await prisma.deviceCredential.update({
      where: { id: phone },
      data: { scopes: ['health:write'] },
    });
    const failed = await prisma.companionEvent.findMany({
      where: { userId: 'alice', status: 'failed' },
    });
    expect(failed.map((r) => r.errorCategory)).toEqual(
      expect.arrayContaining(['CONFLICT', 'BAD_REQUEST', 'FORBIDDEN'])
    );
    expect(failed.find((r) => r.errorCategory === 'BAD_REQUEST')).toMatchObject({
      count: null,
      source: 'unknown',
    });
    expect(JSON.stringify(failed)).not.toContain('do-not-store-secret');
    const before = await prisma.companionEvent.count();
    expect((await ingest(request('/api/health/ingest', healthFixture, 'invalid'))).status).toBe(
      401
    );
    expect(await prisma.companionEvent.count()).toBe(before);
  });
  it('stores explicit diagnostics independently, redacts text, filters/pages and denies cross-owner details', async () => {
    const snapshot = {
      ...snapshotFixture,
      diagnostic: {
        ...snapshotFixture.diagnostic,
        reportAvailable: true,
        report: 'Bearer private-secret\nvela_device_private-token',
      },
      attempts: [{ ...attemptFixture, id: randomUUID(), trigger: 'automatic', retry: 1 }],
    };
    const response = await upload(request('/api/devices/diagnostics', snapshot));
    expect(response.status).toBe(200);
    const receipt = await response.json();
    const detail = await uploadDetail('alice', receipt.id);
    expect(detail.events).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toContain('private-secret');
    await expect(uploadDetail('bob', receipt.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(eventDetail('bob', detail.events[0].id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await listEvents('bob', historyFilterSchema.parse({}))).items).toHaveLength(0);
    expect(
      (
        await listEvents(
          'alice',
          historyFilterSchema.parse({
            kind: 'attempt',
            deviceId: phone,
            trigger: 'automatic',
            status: 'failed',
            from: '2026-01-01',
            to: '2026-01-01',
          })
        )
      ).items
    ).toHaveLength(1);
    const first = await listEvents('alice', historyFilterSchema.parse({ limit: 1 }));
    expect(first.next).not.toBeNull();
    const second = await listEvents(
      'alice',
      historyFilterSchema.parse({ limit: 1, cursor: first.next })
    );
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect((await listUploads('alice', { limit: 1 })).items[0].id).toBe(receipt.id);
    await expect(listUploads('bob', { limit: 1, cursor: receipt.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const overview = await deviceOverview('alice');
    expect(overview[0].lastReported).toMatchObject({ status: 'failed' });
    expect(overview[0].lastUpload?.appVersion).toBe('test');
  });
  it('bounds authenticated ingestion audits without changing health identity', async () => {
    await prisma.companionEvent.createMany({
      data: Array.from({ length: 2001 }, () => ({
        userId: 'alice',
        deviceId: phone,
        kind: 'ingestion',
        status: 'success',
        metrics: [],
        occurredAt: new Date('2026-01-01'),
      })),
    });
    expect((await ingest(request('/api/health/ingest', healthFixture))).status).toBe(200);
    expect(
      await prisma.companionEvent.count({ where: { deviceId: phone, kind: 'ingestion' } })
    ).toBe(2000);
    expect(await prisma.healthMetric.count()).toBe(1);
  });
  it('bounds uploads per device, enforces rate limits and prunes expired records and attempts', async () => {
    await prisma.deviceRateLimit.deleteMany({ where: { key: `diagnostics:${phone}` } });
    await prisma.companionUpload.createMany({
      data: Array.from({ length: 61 }, () => ({
        userId: 'alice',
        deviceId: phone,
        appVersion: 'synthetic',
        version: 1,
        report: {},
      })),
    });
    await saveDiagnostics('alice', phone, { ...snapshotFixture, attempts: [] });
    expect(await prisma.companionUpload.count({ where: { deviceId: phone } })).toBe(60);
    await saveDiagnostics('alice', phone, { ...snapshotFixture, attempts: [] });
    await expect(saveDiagnostics('alice', phone, snapshotFixture)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    const old = await prisma.companionUpload.create({
      data: {
        userId: 'alice',
        deviceId: phone,
        appVersion: 'expired',
        version: 1,
        report: {},
        receivedAt: new Date(Date.now() - 31 * 86400_000),
        events: {
          create: {
            userId: 'alice',
            deviceId: phone,
            kind: 'attempt',
            status: 'failed',
            metrics: [],
          },
        },
      },
    });
    await prisma.companionEvent.create({
      data: {
        userId: 'alice',
        deviceId: phone,
        kind: 'ingestion',
        status: 'received',
        metrics: [],
        receivedAt: new Date(Date.now() - 31 * 86400_000),
      },
    });
    await pruneCompanion('alice');
    expect(await prisma.companionUpload.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.companionEvent.count({ where: { uploadId: old.id } })).toBe(0);
    expect(
      await prisma.companionEvent.count({
        where: { receivedAt: { lt: new Date(Date.now() - 30 * 86400_000) } },
      })
    ).toBe(0);
  });
  it('rejects revoked-device diagnostic uploads without changing saved snapshots', async () => {
    const count = await prisma.companionUpload.count();
    await prisma.deviceCredential.update({ where: { id: phone }, data: { revokedAt: new Date() } });
    expect((await upload(request('/api/devices/diagnostics', snapshotFixture))).status).toBe(401);
    expect(await prisma.companionUpload.count()).toBe(count);
  });
});
