import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import type { HealthMetric, Prisma, PrismaClient } from '../../../generated/prisma/client';
import { diaryDate } from '@/lib/nutrition/dates';
import type { HistoricalRecord } from './model';

type Existing = Pick<
  HealthMetric,
  'id' | 'metric' | 'sourceKey' | 'source' | 'observedAt' | 'value' | 'metadata'
>;
export function matchHistorical(
  record: HistoricalRecord,
  existing: Existing[],
  overwrite: boolean
) {
  const own = existing.find((row) => row.sourceKey === record.sourceKey);
  // Companion/legacy HA metrics are competing daily snapshots, not additive records.
  const daily = record.source === 'samsung_health' && record.metric !== 'BMR';
  const synchronized = existing.filter(
    (row) =>
      row.metric === record.metric &&
      !row.sourceKey.startsWith('historical:') &&
      (daily ||
        row.observedAt.toISOString() === record.observedAt ||
        (record.metric === 'BMR' &&
          ((row.metadata as Record<string, unknown>)?.upstreamId === record.metadata.upstreamId ||
            (row.metadata as Record<string, unknown>)?.sourceObservedAt === record.observedAt)))
  );
  if (synchronized.length) {
    return { action: 'protected' as const };
  }
  if (own) {
    if (!overwrite) {
      return { action: 'skip' as const };
    }
    if (
      Number(own.value) === Number(record.value) &&
      own.observedAt.toISOString() === record.observedAt &&
      isDeepStrictEqual(own.metadata, record.metadata)
    ) {
      return { action: 'skip' as const };
    }
    return { action: 'overwrite' as const, id: own.id };
  }
  return { action: 'create' as const };
}

export type ImportCounts = {
  importable: number;
  skipped: number;
  overwritten: number;
  protected: number;
  possibleHaOverlap: number;
};
export async function persistHistorical(
  db: PrismaClient,
  userId: string,
  records: HistoricalRecord[],
  options: { dryRun: boolean; overwrite: boolean }
): Promise<ImportCounts> {
  const counts: ImportCounts = {
    importable: 0,
    skipped: 0,
    overwritten: 0,
    protected: 0,
    possibleHaOverlap: 0,
  };
  for (let offset = 0; offset < records.length; offset += 100) {
    const batch = records.slice(offset, offset + 100);
    const result = await db.$transaction(
      async (tx) => {
        if (options.dryRun) {
          await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        } else {
          // Same owner lock as Android uploads; uniqueness also protects concurrent importer replays.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`health-upload:${userId}`}, 0))::text`;
        }
        const existing = await tx.healthMetric.findMany({
          where: { userId, date: diaryDate(batch[0].date) },
          take: 10001,
        });
        if (existing.length > 10000) {
          throw new Error('More than 10000 existing measurements on one date.');
        }
        const results = [];
        for (const record of batch) {
          const match = matchHistorical(record, existing, options.overwrite);
          const possibleHaOverlap =
            record.source === 'withings' &&
            existing.some(
              (r) =>
                r.source === 'home_assistant' &&
                r.metric === record.metric &&
                r.observedAt.toISOString() !== record.observedAt
            );
          results.push({ action: match.action, possibleHaOverlap });
          if (options.dryRun || match.action === 'skip' || match.action === 'protected') {
            continue;
          }
          const data = {
            ...record,
            date: diaryDate(record.date),
            observedAt: new Date(record.observedAt),
            metadata: record.metadata as Prisma.InputJsonObject,
          };
          if (match.action === 'overwrite') {
            await tx.healthMetric.update({
              where: { id: match.id },
              data: { ...data, receivedAt: new Date() },
            });
          } else {
            await tx.healthMetric.create({ data: { ...data, userId } });
          }
        }
        return results;
      },
      { timeout: 15000 }
    );
    for (const item of result) {
      if (item.action === 'create') {
        counts.importable++;
      } else if (item.action === 'overwrite') {
        counts.overwritten++;
      } else {
        counts.skipped++;
        if (item.action === 'protected') {
          counts.protected++;
        }
      }
      if (item.possibleHaOverlap) {
        counts.possibleHaOverlap++;
      }
    }
  }
  return counts;
}
