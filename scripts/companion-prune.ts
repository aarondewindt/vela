import 'dotenv/config';
import { pruneCompanion } from '../lib/companion/service';
import { prisma } from '../lib/prisma';
async function main() {
  try {
    await pruneCompanion();
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(() => {
  process.stderr.write('Companion retention cleanup failed.\n');
  process.exitCode = 1;
});
