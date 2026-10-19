import 'server-only';
import { prisma } from '@/lib/prisma';
import { diaryDate } from '@/lib/nutrition/dates';
import type { HomeAssistantState } from '@/lib/integrations/home-assistant/client';
import type { MetricKind } from './schema';
import { normalizeMetric } from './normalization';

export type ImportContext = {
  userId: string;
  sourceNamespace: string;
  revision: number;
  leaseId: string;
  timezone: string;
  mappings: { metric: MetricKind; entityId: string }[];
};
/** Fences imports against connection edits, disabled connections and expired worker leases. */
export async function importHealthStates(context: ImportContext, states: HomeAssistantState[]) {
  const normalized = states
    .flatMap((state) => {
      const mapping = context.mappings.find((x) => x.entityId === state.entity_id);
      const value = mapping && normalizeMetric(mapping.metric, state, context.timezone);
      return value
        ? [{ ...value, sourceKey: `ha:${context.sourceNamespace}:${value.sourceKey.slice(3)}` }]
        : [];
    })
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  for (let offset = 0; offset < normalized.length; offset += 100) {
    await prisma.$transaction(
      async (db) => {
        const fenced = await db.homeAssistantConnection.updateMany({
          where: {
            userId: context.userId,
            revision: context.revision,
            leaseId: context.leaseId,
            enabled: true,
            leaseExpiresAt: { gt: new Date() },
          },
          data: { leaseExpiresAt: new Date(Date.now() + 60000) },
        });
        if (!fenced.count) {
          throw new Error('Connection changed or lease expired.');
        }
        for (const record of normalized.slice(offset, offset + 100)) {
          const { date, ...data } = record;
          const key = { userId: context.userId, sourceKey: record.sourceKey };
          const existing = await db.healthMetric.findUnique({
            where: { userId_sourceKey: key },
            select: { observedAt: true },
          });
          if (existing && existing.observedAt > record.observedAt) {
            continue;
          }
          await db.healthMetric.upsert({
            where: { userId_sourceKey: key },
            create: { ...data, userId: context.userId, date: diaryDate(date) },
            update: { ...data, date: diaryDate(date), receivedAt: new Date() },
          });
        }
      },
      { timeout: 15000 }
    );
  }
}
