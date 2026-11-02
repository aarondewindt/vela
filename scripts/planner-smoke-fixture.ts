import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'], quiet: true });
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { prisma } from '../lib/prisma';

/** Disposable owner: smoke tests never read or edit an existing user's records. */
export async function plannerSmokeAccount() {
  const id = randomUUID();
  const email = `planner-smoke-${id}@example.test`;
  const password = `Planner-${randomUUID()}`;
  await prisma.user.create({
    data: {
      id,
      name: 'Synthetic Planner smoke',
      email,
      timezone: 'Europe/Amsterdam',
      accounts: {
        create: {
          id: randomUUID(),
          accountId: id,
          providerId: 'credential',
          password: await hashPassword(password),
        },
      },
    },
  });
  return { id, email, password, cleanup: () => prisma.user.delete({ where: { id } }) };
}
