import type { Prisma } from '../../generated/prisma/client';
import type { z } from 'zod';
import type { configurationSchema } from './schema';

export type EmbeddingConfiguration = z.infer<typeof configurationSchema>;
export type EmbeddingDocument = { id: string; text: string; sourceHash: string; updatedAt: Date };
export type StoredEmbedding = { id: string; sourceHash: string; sourceUpdatedAt: Date };
export type EmbeddingWrite = { document: EmbeddingDocument; vector?: number[] };

/** Each adapter owns a dedicated vector table, bound to one collection key. */
export interface EmbeddingCollectionAdapter<Result> {
  key: string;
  preparationVersion: string;
  // lock=true is used only inside the short publication transaction.
  documents(
    db: Prisma.TransactionClient,
    userId?: string,
    lock?: boolean
  ): Promise<EmbeddingDocument[]>;
  stored(db: Prisma.TransactionClient, userId?: string): Promise<StoredEmbedding[]>;
  clear(db: Prisma.TransactionClient, userId?: string): Promise<void>;
  write(db: Prisma.TransactionClient, records: EmbeddingWrite[]): Promise<void>;
  search(
    db: Prisma.TransactionClient,
    userId: string,
    vector: number[],
    limit: number
  ): Promise<Result[]>;
}
