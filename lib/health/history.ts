import 'server-only';
import { Prisma } from '../../generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { dateInTimezone, diaryDate } from '@/lib/nutrition/dates';
import { readNutritionHistoryRecords } from '@/lib/nutrition/history';
import { settingsService } from '@/lib/settings/service';
import { readHealthMetrics } from './persistence';
import { healthRangeStart, healthChartInputSchema } from './history-range';
import { aggregateHealthHistory } from './history-aggregation';
import type { z } from 'zod';

export async function healthChartHistory(
  userId: string,
  raw: z.infer<typeof healthChartInputSchema>
) {
  const input = healthChartInputSchema.parse(raw);
  const { timezone } = await settingsService.getPreferences(userId);
  const today = dateInTimezone(timezone);
  // Calendar labels already assigned by ingestion are retained, including after travel.
  const endDate = input.endDate > today ? today : input.endDate;
  let startDate = healthRangeStart(endDate, input.range);
  if (!startDate) {
    const [first] = await prisma.$queryRaw<{ date: Date | null }[]>(Prisma.sql`
      SELECT MIN(first_date) AS date FROM (
        SELECT MIN(date) AS first_date FROM health_metrics
          WHERE "userId" = ${userId} AND date <= ${diaryDate(endDate)}
        UNION ALL
        SELECT MIN("logDate") AS first_date FROM nutrition_log_entries
          WHERE "userId" = ${userId} AND "logDate" <= ${diaryDate(endDate)}
      ) dates
    `);
    startDate = first?.date?.toISOString().slice(0, 10) ?? endDate;
  }
  const [records, nutrition] = await Promise.all([
    readHealthMetrics(userId, startDate, endDate),
    readNutritionHistoryRecords(userId, startDate, endDate),
  ]);
  return {
    startDate,
    endDate,
    timezone,
    ...aggregateHealthHistory(
      startDate,
      endDate,
      today,
      records
        .filter((record) => record.date >= diaryDate(startDate))
        .map((record) => ({
          ...record,
          date: record.date.toISOString().slice(0, 10),
          value: Number(record.value),
        })),
      nutrition.map((record) => ({
        date: record.logDate.toISOString().slice(0, 10),
        calories: Number(record._sum.calories),
      }))
    ),
  };
}
