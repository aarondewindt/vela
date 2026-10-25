import 'server-only';
import { prisma } from '@/lib/prisma';
import { Prisma, type HealthMetric } from '../../generated/prisma/client';
import { diaryDate } from '@/lib/nutrition/dates';

// One authoritative row per metric/date; never sum competing sources or captures.
export function readHealthMetrics(userId: string, startDate: string, endDate: string) {
  return prisma.$queryRaw<HealthMetric[]>(Prisma.sql`
        (SELECT DISTINCT ON ("date", metric) * FROM health_metrics
        WHERE "userId" = ${userId} AND "date" >= ${diaryDate(startDate)}
          AND "date" <= ${diaryDate(endDate)}
        ORDER BY "date", metric,
          CASE WHEN metric IN ('TOTAL_CALORIES', 'ACTIVE_CALORIES', 'STEPS', 'SLEEP', 'BMR') THEN
            CASE source WHEN 'samsung_health' THEN 2 WHEN 'manual' THEN 1 ELSE 0 END
          ELSE CASE source WHEN 'home_assistant' THEN 2 WHEN 'manual' THEN 1 ELSE 0 END END DESC,
          "observedAt" DESC, "receivedAt" DESC, id DESC)
        UNION ALL
        (SELECT DISTINCT ON (metric) * FROM health_metrics
        WHERE "userId" = ${userId} AND "date" < ${diaryDate(startDate)}
          AND metric IN ('WEIGHT', 'BODY_FAT', 'LEAN_MASS', 'BMR')
        ORDER BY metric, "date" DESC,
          CASE WHEN metric = 'BMR' THEN
            CASE source WHEN 'samsung_health' THEN 2 WHEN 'manual' THEN 1 ELSE 0 END
          ELSE CASE source WHEN 'home_assistant' THEN 2 WHEN 'manual' THEN 1 ELSE 0 END END DESC,
          "observedAt" DESC, "receivedAt" DESC, id DESC)
      `);
}
