import 'server-only';

import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { attachmentStorage, isMissingFile, type FileStorage } from '@/lib/storage/local';
import { validateImage } from './image';

export const attachmentSelect = {
  id: true,
  originalFilename: true,
  mimeType: true,
  size: true,
  width: true,
  height: true,
  createdAt: true,
} satisfies Prisma.AttachmentSelect;

function notFound(): never {
  throw new TRPCError({ code: 'NOT_FOUND', message: 'Attachment not found.' });
}

/** Call within the SAME transaction that persists the consumer's attachment IDs.
 * The conditional update serializes against deletion/cleanup. Retention is permanent
 * for now: removing one consumer must never remove an image used by another.
 */
export async function retainAttachments(
  tx: Prisma.TransactionClient,
  userId: string,
  ids: string[]
) {
  const uniqueIds = [...new Set(ids)];
  const result = await tx.attachment.updateMany({
    where: { id: { in: uniqueIds }, userId, ready: true, deleteRequestedAt: null },
    data: { retainedAt: new Date() },
  });
  if (result.count !== uniqueIds.length) {
    notFound();
  }
}

export function createAttachmentService(
  storage: () => FileStorage = attachmentStorage,
  database = prisma
) {
  async function finishDeletion(row: { id: string; storageKey: string }) {
    // Keep the tombstone on storage errors; a later prune retries it.
    await storage().remove(row.storageKey);
    await database.attachment.deleteMany({
      where: { id: row.id, deleteRequestedAt: { not: null } },
    });
  }

  return {
    async upload(userId: string, bytes: Buffer, filename: string, mimeType: string) {
      const image = await validateImage(bytes, mimeType);
      // Original name is display metadata only; normalize both Unix and Windows paths.
      const originalFilename =
        filename
          .replace(/\\/g, '/')
          .split('/')
          .pop()!
          // eslint-disable-next-line no-control-regex -- Remove controls from display metadata.
          .replace(/[\u0000-\u001f\u007f]/g, '')
          .trim()
          .slice(0, 255) || 'image';
      const id = randomUUID();
      const storageKey = `${id}.bin`;
      const backend = storage();
      // Durable pending record comes first, so even a crash during write is recoverable.
      await database.attachment.create({
        data: { id, userId, storageKey, originalFilename, size: bytes.length, ...image },
      });
      try {
        return await database.$transaction(
          async (tx) => {
            // Lock the pending row across filesystem work. Cleanup cannot race the write.
            const locked = await tx.attachment.updateMany({
              where: { id, ready: false, deleteRequestedAt: null },
              data: { ready: false },
            });
            if (!locked.count) {
              notFound();
            }
            await backend.put(storageKey, bytes);
            return tx.attachment.update({
              where: { id },
              data: { ready: true },
              select: attachmentSelect,
            });
          },
          { timeout: 30_000 }
        );
      } catch (error) {
        try {
          // A connection failure at commit has an ambiguous outcome. Only clean pending
          // rows; a committed READY upload remains recoverable by normal orphan pruning.
          const claimed = await database.attachment.updateMany({
            where: { id, ready: false, retainedAt: null },
            data: { deleteRequestedAt: new Date() },
          });
          if (claimed.count) {
            await finishDeletion({ id, storageKey });
          }
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'Upload failed; cleanup requires retry.');
        }
        throw error;
      }
    },

    async retrieve(userId: string, id: string) {
      const row = await database.attachment.findFirst({
        where: { id, userId, ready: true, deleteRequestedAt: null },
      });
      if (!row) {
        notFound();
      }
      try {
        return { metadata: row, bytes: await storage().get(row.storageKey) };
      } catch (error) {
        if (isMissingFile(error)) {
          notFound();
        }
        throw error;
      }
    },

    async remove(userId: string, id: string) {
      const row = await database.attachment.findFirst({ where: { id, userId, ready: true } });
      if (!row) {
        notFound();
      }
      const claimed = await database.attachment.updateMany({
        where: { id, userId, retainedAt: null },
        data: { deleteRequestedAt: new Date() },
      });
      if (!claimed.count) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This attachment is retained by saved content.',
        });
      }
      await finishDeletion(row);
    },

    /** Bounded, retryable cleanup. Run repeatedly from a supervised scheduler. */
    async prune(now = new Date()) {
      const pendingBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const unusedBefore = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const eligible = {
        retainedAt: null,
        OR: [
          { deleteRequestedAt: { not: null } },
          { ready: false, createdAt: { lt: pendingBefore } },
          { ready: true, createdAt: { lt: unusedBefore } },
        ],
      } satisfies Prisma.AttachmentWhereInput;
      const rows = await database.attachment.findMany({
        where: eligible,
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
      for (const row of rows) {
        const claimed = await database.attachment.updateMany({
          where: { id: row.id, ...eligible },
          data: { deleteRequestedAt: now },
        });
        if (claimed.count) {
          await finishDeletion(row);
        }
      }
      return rows.length;
    },
  };
}

export const attachmentService = createAttachmentService();
