/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({ prisma: { $transaction: jest.fn() } }));
import { prisma } from '@/lib/prisma';
import { healthUploadSchema, ingestHealth } from './ingestion';
const m = {
  metric: 'TOTAL_CALORIES',
  value: 2400,
  unit: 'kcal',
  date: '2026-03-29',
  timezone: 'Europe/Amsterdam',
  observedAt: '2026-03-30T10:00:00Z',
  periodStart: '2026-03-28T23:00:00Z',
  periodEnd: '2026-03-29T22:00:00Z',
  measurementKind: 'sdk_aggregate_semantics_unverified',
};
const payload = { version: 1, source: 'samsung_health', measurements: [m] };
const db = { $queryRaw: jest.fn(), healthMetric: { findUnique: jest.fn(), upsert: jest.fn() } };
beforeEach(() => {
  jest.clearAllMocks();
  (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(db));
  db.healthMetric.findUnique.mockResolvedValue(null);
});
it('accepts a DST-short calendar day and keeps total and active separate', async () => {
  await ingestHealth('alice', 'phone', {
    ...payload,
    measurements: [m, { ...m, metric: 'ACTIVE_CALORIES', value: 400 }],
  });
  expect(db.healthMetric.upsert).toHaveBeenCalledTimes(2);
  expect(db.healthMetric.upsert).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      create: expect.objectContaining({
        userId: 'alice',
        source: 'samsung_health',
        value: 2400,
        sourceKey: 'device:phone:samsung_health:TOTAL_CALORIES:2026-03-29',
      }),
    })
  );
});
it.each([
  { unit: 'kJ' },
  { timezone: 'bad' },
  { value: -1 },
  { value: Infinity },
  { date: '2026-03-28' },
  { periodEnd: '2026-03-31T00:00:00Z' },
  { observedAt: '2099-01-01T00:00:00Z' },
  { userId: 'bob' },
])('rejects invalid measurement %j', (extra) => {
  expect(
    healthUploadSchema.safeParse({ ...payload, measurements: [{ ...m, ...extra }] }).success
  ).toBe(false);
});
it('rejects duplicate keys and oversized batches', () => {
  expect(healthUploadSchema.safeParse({ ...payload, measurements: [m, m] }).success).toBe(false);
  expect(
    healthUploadSchema.safeParse({ ...payload, measurements: Array(101).fill(m) }).success
  ).toBe(false);
});
it('retries do not write and older snapshots cannot overwrite corrections', async () => {
  db.healthMetric.findUnique.mockResolvedValue({
    observedAt: new Date(m.observedAt),
    value: m.value,
    metadata: {
      timezone: m.timezone,
      periodStart: m.periodStart,
      periodEnd: m.periodEnd,
      measurementKind: m.measurementKind,
      credentialId: 'phone',
      unit: 'kcal',
    },
  });
  expect((await ingestHealth('alice', 'phone', payload)).results[0].status).toBe('unchanged');
  db.healthMetric.findUnique.mockResolvedValue({ observedAt: new Date('2026-03-31T00:00:00Z') });
  expect((await ingestHealth('alice', 'phone', payload)).results[0].status).toBe('stale');
  expect(db.healthMetric.upsert).not.toHaveBeenCalled();
});
it('accepts downward corrections from newer captures', async () => {
  db.healthMetric.findUnique.mockResolvedValue({
    observedAt: new Date('2026-03-30T09:00:00Z'),
    value: 2600,
  });
  expect((await ingestHealth('alice', 'phone', payload)).results[0].status).toBe('updated');
  expect(db.healthMetric.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ update: expect.objectContaining({ value: 2400 }) })
  );
});
it('rejects conflicting reuse of a capture timestamp', async () => {
  db.healthMetric.findUnique.mockResolvedValue({
    observedAt: new Date(m.observedAt),
    value: 1000,
    metadata: {},
  });
  await expect(ingestHealth('alice', 'phone', payload)).rejects.toMatchObject({ code: 'CONFLICT' });
});
