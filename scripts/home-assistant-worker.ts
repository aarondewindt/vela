import nextEnv from '@next/env';
import { setTimeout as delay } from 'node:timers/promises';
async function main() {
  nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
  const { prisma } = await import('../lib/prisma');
  const { syncHomeAssistant } = await import('../lib/integrations/home-assistant/worker');
  if (process.argv.includes('--check')) {
    await prisma.homeAssistantConnection.count();
    process.stdout.write(
      'Home Assistant worker runtime and database ready. No connections opened.\n'
    );
    await prisma.$disconnect();
    return;
  }
  const stop = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => stop.abort());
  }
  const running = new Map<string, Promise<void>>();
  const retries = new Map<string, { attempts: number; at: number }>();
  try {
    while (!stop.signal.aborted) {
      const connections = await prisma.homeAssistantConnection.findMany({
        where: { enabled: true, mappings: { some: {} } },
        select: { userId: true },
      });
      for (const { userId } of connections) {
        if (running.size >= 10) {
          break;
        }
        if (running.has(userId) || (retries.get(userId)?.at ?? 0) > Date.now()) {
          continue;
        }
        const operation = syncHomeAssistant(userId, stop.signal)
          .then((result) => {
            const attempts = result.succeeded ? 0 : (retries.get(userId)?.attempts ?? 0) + 1;
            retries.set(userId, {
              attempts,
              at:
                Date.now() +
                (attempts ? Math.min(300000, 5000 * 2 ** Math.min(attempts, 6)) : 5000),
            });
          })
          .catch(() => {
            retries.set(userId, { attempts: 6, at: Date.now() + 300000 });
            process.stderr.write('Home Assistant worker storage failure; retry scheduled.\n');
          })
          .finally(() => {
            running.delete(userId);
          });
        running.set(userId, operation);
      }
      await delay(5000, undefined, { signal: stop.signal }).catch((error) => {
        if (error.name !== 'AbortError') {
          throw error;
        }
      });
    }
  } finally {
    stop.abort();
    await Promise.allSettled(running.values());
    await prisma.$disconnect();
  }
}
main().catch(() => {
  process.stderr.write('Home Assistant worker stopped. Check database and configuration.\n');
  process.exitCode = 1;
});
