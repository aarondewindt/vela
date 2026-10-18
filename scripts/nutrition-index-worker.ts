import nextEnv from '@next/env';
import { setTimeout as delay } from 'node:timers/promises';

async function main() {
  // Match Next.js environment-file precedence before constructing Prisma/model clients.
  nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
  const { processNextProductIndexJob } = await import('../lib/nutrition/product-index-worker');
  const { prisma } = await import('../lib/prisma');
  if (process.argv.includes('--check')) {
    process.stdout.write('Product index worker runtime ready. No jobs processed.\n');
    await prisma.$disconnect();
    return;
  }
  const once = process.argv.includes('--once');
  const ownerArgument = process.argv.indexOf('--user');
  const userId = ownerArgument >= 0 ? process.argv[ownerArgument + 1] : undefined;
  if (ownerArgument >= 0 && (!userId || userId.startsWith('--'))) {
    throw new Error('The --user option needs a user ID.');
  }
  let stopping = false;
  const shutdown = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      stopping = true;
      shutdown.abort();
    });
  }
  try {
    do {
      const result = await processNextProductIndexJob(userId);
      if (result.processed) {
        process.stdout.write(
          result.succeeded
            ? 'Product index refresh completed.\n'
            : 'Product index refresh scheduled for retry.\n'
        );
      }
      if (!once && !stopping) {
        await delay(5000, undefined, { signal: shutdown.signal }).catch((error: unknown) => {
          if (!(error instanceof Error && error.name === 'AbortError')) {
            throw error;
          }
        });
      }
    } while (!once && !stopping);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  process.stderr.write(
    'Product index worker stopped after a startup or storage failure. Check configuration and restart it.\n'
  );
  process.exitCode = 1;
});
