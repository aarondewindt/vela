import nextEnv from '@next/env';
import { importArguments } from '../lib/health/historical/runner';

export async function healthImportMain(provider: 'withings' | 'samsung') {
  // Fail on invalid CLI arguments before loading database configuration.
  importArguments(process.argv.slice(2));
  nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
  const { prisma } = await import('../lib/prisma');
  try {
    const { runHistoricalImport } = await import('../lib/health/historical/runner');
    await runHistoricalImport(provider, process.argv.slice(2), prisma);
  } finally {
    await prisma.$disconnect();
  }
}
export function importFailed(error: unknown) {
  process.stderr.write(
    error instanceof Error && error.constructor === Error
      ? `${error.message}\n`
      : 'Historical import failed. Check database access and export configuration.\n'
  );
  process.exitCode = 1;
}
