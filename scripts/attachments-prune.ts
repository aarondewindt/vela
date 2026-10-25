import 'dotenv/config';
import { attachmentService } from '../lib/attachments/service';
import { prisma } from '../lib/prisma';

async function main() {
  try {
    const examined = await attachmentService.prune();
    process.stdout.write(`Attachment cleanup examined ${examined} candidates.\n`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(() => {
  process.stderr.write(
    'Attachment cleanup failed; pending deletions will be retried on the next run.\n'
  );
  process.exitCode = 1;
});
