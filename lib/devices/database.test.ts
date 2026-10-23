/** @jest-environment node */
// Opt-in PostgreSQL tests. A unique temporary schema is created and dropped;
// existing application tables and credentials are never touched.
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => {
  const { PrismaClient } = jest.requireActual('@/generated/prisma/client');
  const { PrismaPg } = jest.requireActual('@prisma/adapter-pg');
  const testSchema = `device_test_${require('node:crypto').randomBytes(8).toString('hex')}`;
  return {
    testSchema,
    prisma: new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: process.env.DATABASE_URL,
          options: `-c search_path=${testSchema}`,
        },
        { schema: testSchema }
      ),
    }),
  };
});
import { readFileSync } from 'node:fs';
import { prisma } from '@/lib/prisma';
import {
  approvePairing,
  hashSecret,
  listDevices,
  rateLimit,
  redeemPairing,
  requireDevice,
  revokeDevice,
  startPairing,
} from './service';
const { testSchema } = jest.requireMock('@/lib/prisma') as { testSchema: string };
const suite = process.env.VELA_DEVICE_DB_TESTS === '1' ? describe : describe.skip;
suite('device authentication on PostgreSQL', () => {
  beforeAll(async () => {
    process.env.BETTER_AUTH_URL = 'https://vela.example';
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${testSchema}"`);
    await prisma.$executeRawUnsafe(`CREATE TABLE "${testSchema}"."user" (id TEXT PRIMARY KEY)`);
    // Statements contain only repository-owned DDL, using the isolated search_path.
    const sql = readFileSync(
      'prisma/migrations/20261024000000_device_credentials/migration.sql',
      'utf8'
    );
    for (const statement of sql.split(';').filter((value) => value.trim())) {
      await prisma.$executeRawUnsafe(statement);
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${testSchema}"."user" (id) VALUES ('alice'), ('bob')`
    );
  });
  afterAll(async () => {
    try {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
    } finally {
      await prisma.$disconnect();
    }
  });
  it('issues exactly one token under concurrent redemption, isolates owners, and immediately revokes', async () => {
    const pairing = await startPairing({ name: 'Test phone', clientType: 'android' });
    await expect(redeemPairing(pairing.code)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await approvePairing('alice', pairing.code);
    await expect(approvePairing('bob', pairing.code)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    const attempts = await Promise.allSettled([
      redeemPairing(pairing.sessionSecret),
      redeemPairing(pairing.sessionSecret),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const success = attempts.find(
      (result) => result.status === 'fulfilled'
    ) as PromiseFulfilledResult<Awaited<ReturnType<typeof redeemPairing>>>;
    const token = success.value.token!;
    expect(token).toMatch(/^vela_device_[A-Za-z0-9_-]{43}$/);
    const credential = await prisma.deviceCredential.findUniqueOrThrow({
      where: { tokenHash: hashSecret(token) },
    });
    expect(credential.userId).toBe('alice');
    expect(await listDevices('bob')).toEqual([]);
    const headers = new Headers({ authorization: `Bearer ${token}` });
    expect((await requireDevice(headers, ['health:write'])).userId).toBe('alice');
    await expect(requireDevice(headers, ['health:read'])).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(revokeDevice('bob', credential.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await revokeDevice('alice', credential.id);
    await expect(requireDevice(headers, ['health:write'])).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(redeemPairing(pairing.sessionSecret)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(await prisma.deviceCredential.count()).toBe(1);
    const saved = JSON.stringify(await prisma.devicePairing.findMany());
    expect(saved).not.toContain(pairing.code);
    expect(saved).not.toContain(pairing.sessionSecret);
  });
  it('rejects expired pairing and credentials', async () => {
    const pairing = await startPairing({ name: 'Expired', clientType: 'script' });
    await prisma.devicePairing.updateMany({
      where: { secretHash: hashSecret(pairing.sessionSecret) },
      data: { expiresAt: new Date(0) },
    });
    await expect(approvePairing('alice', pairing.code)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(redeemPairing(pairing.sessionSecret)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    const token = `vela_device_${'a'.repeat(43)}`;
    await prisma.deviceCredential.create({
      data: {
        userId: 'alice',
        name: 'Expired',
        clientType: 'script',
        tokenHash: hashSecret(token),
        scopes: ['health:write'],
        expiresAt: new Date(0),
      },
    });
    await expect(
      requireDevice(new Headers({ authorization: `Bearer ${token}` }), ['health:write'])
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('counts parallel requests atomically', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => rateLimit('test:atomic', 3))
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
  });
});
