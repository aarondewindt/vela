import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { requireDeviceHttps } from './http';
import { prisma } from '@/lib/prisma';

export const hashSecret = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const fail = () =>
  new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid or expired credential.' });
export const deviceSelect = {
  id: true,
  name: true,
  clientType: true,
  scopes: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
} as const;

// Fixed-cardinality, database-backed windows survive restarts and multiple app processes.
export async function rateLimit(key: string, limit: number) {
  const window = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO device_rate_limits (key, "window", count) VALUES (${key}, ${window}, 1)
    ON CONFLICT (key) DO UPDATE SET count = CASE WHEN device_rate_limits."window" = ${window}
      THEN device_rate_limits.count + 1 ELSE 1 END, "window" = ${window}
    RETURNING count`;
  if (rows[0].count > limit) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Try again in a minute.' });
  }
}

export async function startPairing(input: { name: string; clientType: string }) {
  requireDeviceHttps();
  await rateLimit('pairing:start', 20);
  const sessionSecret = secret();
  const code = randomBytes(6).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await prisma.devicePairing.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.devicePairing.create({
    data: {
      ...input,
      codeHash: hashSecret(code),
      secretHash: hashSecret(sessionSecret),
      expiresAt,
    },
  });
  return { code, sessionSecret, expiresAt, approvalPath: '/settings/devices' };
}

export async function reviewPairing(userId: string, code: string) {
  await rateLimit(`pairing:review:${userId}`, 10);
  const pairing = await prisma.devicePairing.findFirst({
    where: {
      codeHash: hashSecret(code),
      expiresAt: { gt: new Date() },
      consumedAt: null,
      OR: [{ userId: null }, { userId }],
    },
    select: { name: true, clientType: true, expiresAt: true },
  });
  if (!pairing) {
    throw fail();
  }
  return { ...pairing, scopes: ['health:write'] };
}

export async function approvePairing(userId: string, code: string) {
  requireDeviceHttps();
  await rateLimit(`pairing:approve:${userId}`, 10);
  const result = await prisma.devicePairing.updateMany({
    where: {
      codeHash: hashSecret(code),
      userId: null,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { userId },
  });
  if (result.count !== 1) {
    throw fail();
  }
  return { approved: true };
}

export async function redeemPairing(sessionSecret: string) {
  await rateLimit('pairing:redeem', 120);
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const pairing = await tx.devicePairing.findUnique({
      where: { secretHash: hashSecret(sessionSecret) },
    });
    if (!pairing || pairing.expiresAt <= now || pairing.consumedAt) {
      throw fail();
    }
    if (!pairing.userId) {
      return { status: 'pending' as const };
    }
    const claimed = await tx.devicePairing.updateMany({
      where: {
        id: pairing.id,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) {
      throw fail();
    }
    const token = `vela_device_${secret()}`;
    await tx.deviceCredential.create({
      data: {
        userId: pairing.userId,
        name: pairing.name,
        clientType: pairing.clientType,
        scopes: ['health:write'],
        tokenHash: hashSecret(token),
      },
    });
    return { status: 'paired' as const, token, scopes: ['health:write'] };
  });
}

export async function requireDevice(headers: Headers, requiredScopes: readonly string[]) {
  requireDeviceHttps();
  await rateLimit('device:verify', 600);
  const match = /^Bearer (vela_device_[A-Za-z0-9_-]{43})$/.exec(headers.get('authorization') ?? '');
  if (!match) {
    throw fail();
  }
  const credential = await prisma.deviceCredential.findUnique({
    where: { tokenHash: hashSecret(match[1]) },
  });
  const now = new Date();
  if (
    !credential ||
    credential.revokedAt ||
    (credential.expiresAt && credential.expiresAt <= now)
  ) {
    throw fail();
  }
  if (!requiredScopes.every((scope) => credential.scopes.includes(scope))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient device permissions.' });
  }
  await prisma.deviceCredential.update({ where: { id: credential.id }, data: { lastUsedAt: now } });
  return { userId: credential.userId, credentialId: credential.id, scopes: credential.scopes };
}

export function listDevices(userId: string) {
  return prisma.deviceCredential.findMany({
    where: { userId },
    select: deviceSelect,
    orderBy: { createdAt: 'desc' },
  });
}
export async function revokeDevice(userId: string, id: string) {
  const result = await prisma.deviceCredential.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!result.count) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Device not found.' });
  }
  return { revoked: true };
}
