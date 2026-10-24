/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    devicePairing: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    deviceCredential: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));
import { prisma } from '@/lib/prisma';
import {
  approvePairing,
  hashSecret,
  listDevices,
  rateLimit,
  redeemPairing,
  requireDevice,
  reviewPairing,
  revokeDevice,
  startPairing,
} from './service';
const pairing = prisma.devicePairing as unknown as Record<string, jest.Mock>;
const devices = prisma.deviceCredential as unknown as Record<string, jest.Mock>;
const token = `vela_device_${'a'.repeat(43)}`;
const headers = new Headers({ authorization: `Bearer ${token}` });
beforeEach(() => {
  jest.resetAllMocks();
  process.env.BETTER_AUTH_URL = 'https://vela.example';
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ count: 1 }]);
  (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(prisma));
  pairing.updateMany.mockResolvedValue({ count: 1 });
  devices.updateMany.mockResolvedValue({ count: 1 });
});
function approved() {
  return {
    id: 'pairing',
    userId: 'alice',
    name: 'Phone',
    clientType: 'android',
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  };
}
it('issues independent random secrets and persists only hashes, with a ten-minute lifetime', async () => {
  const first = await startPairing({ name: 'Phone', clientType: 'android' });
  const second = await startPairing({ name: 'Phone', clientType: 'android' });
  expect(first.sessionSecret).not.toBe(second.sessionSecret);
  expect(first.code).toMatch(/^[A-F0-9]{12}$/);
  const saved = pairing.create.mock.calls[0][0].data;
  expect(saved).toEqual(
    expect.objectContaining({
      codeHash: hashSecret(first.code),
      secretHash: hashSecret(first.sessionSecret),
    })
  );
  expect(JSON.stringify(saved)).not.toContain(first.sessionSecret);
  expect(first.expiresAt.getTime() - Date.now()).toBeGreaterThan(599_000);
});
it('approves only an unclaimed live pairing and does not reveal the session secret', async () => {
  pairing.findFirst.mockResolvedValue({
    name: 'Phone',
    clientType: 'android',
    expiresAt: new Date(),
  });
  expect(await reviewPairing('alice', 'ABCDEF123456')).toEqual(
    expect.objectContaining({ scopes: ['health:write'] })
  );
  await approvePairing('alice', 'ABCDEF123456');
  expect(pairing.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ userId: null, consumedAt: null }),
      data: { userId: 'alice' },
    })
  );
  pairing.updateMany.mockResolvedValue({ count: 0 });
  await expect(approvePairing('bob', 'ABCDEF123456')).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
});
it('requires the separate secret, waits for approval, then issues a narrow token once', async () => {
  pairing.findUnique.mockResolvedValue({ ...approved(), userId: null });
  expect(await redeemPairing('secret')).toEqual({ status: 'pending' });
  expect(devices.create).not.toHaveBeenCalled();
  pairing.findUnique.mockResolvedValue(approved());
  const result = await redeemPairing('secret');
  expect(result.status).toBe('paired');
  const data = devices.create.mock.calls[0][0].data;
  expect(data).toEqual(
    expect.objectContaining({
      userId: 'alice',
      scopes: ['health:write'],
      tokenHash: hashSecret(result.token!),
    })
  );
  expect(JSON.stringify(data)).not.toContain(result.token);
  pairing.updateMany.mockResolvedValue({ count: 0 });
  await expect(redeemPairing('secret')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  expect(devices.create).toHaveBeenCalledTimes(1);
});
it.each([
  null,
  { ...approved(), expiresAt: new Date(0) },
  { ...approved(), consumedAt: new Date() },
])('rejects wrong, expired and replayed pairing secrets', async (value) => {
  pairing.findUnique.mockResolvedValue(value);
  await expect(redeemPairing('wrong')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  expect(devices.create).not.toHaveBeenCalled();
});
it('derives owner from the credential and never returns its hash', async () => {
  devices.findUnique.mockResolvedValue({
    id: 'device',
    userId: 'alice',
    scopes: ['health:write'],
    tokenHash: hashSecret(token),
  });
  expect(await requireDevice(headers, ['health:write'])).toEqual({
    userId: 'alice',
    credentialId: 'device',
    scopes: ['health:write'],
  });
  expect(devices.update).toHaveBeenCalled();
  await expect(requireDevice(headers, ['health:read'])).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});
it.each([null, { revokedAt: new Date() }, { expiresAt: new Date(0) }])(
  'rejects wrong, revoked and expired credentials',
  async (value) => {
    devices.findUnique.mockResolvedValue(value);
    await expect(requireDevice(headers, ['health:write'])).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  }
);
it.each(['', 'Basic secret', 'Bearer short', `Bearer vela_device_${'a'.repeat(44)}`])(
  'rejects missing/malformed authentication',
  async (authorization) => {
    await expect(requireDevice(new Headers({ authorization }), [])).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(devices.findUnique).not.toHaveBeenCalled();
  }
);
it('isolates listing and revocation by owner and selects no secret fields', async () => {
  await listDevices('alice');
  const args = devices.findMany.mock.calls[0][0];
  expect(args.where).toEqual({ userId: 'alice' });
  expect(args.select.tokenHash).toBeUndefined();
  await revokeDevice('alice', 'device');
  expect(devices.updateMany.mock.calls[0][0].where).toEqual({
    userId: 'alice',
    id: 'device',
    revokedAt: null,
  });
  devices.updateMany.mockResolvedValue({ count: 0 });
  await expect(revokeDevice('bob', 'device')).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('enforces rate limits and HTTPS', async () => {
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ count: 21 }]);
  await expect(rateLimit('pairing:start', 20)).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  process.env.BETTER_AUTH_URL = 'http://localhost:3000';
  await expect(startPairing({ name: 'Phone', clientType: 'android' })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});
