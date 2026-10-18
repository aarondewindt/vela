import 'server-only';
import { prisma } from '@/lib/prisma';
import { diaryDate, shiftDiaryDate } from './dates';
import { sumNutrition } from './calculations';
import type { Nutrients } from './types';
import { historyInputSchema, type HistoryInput } from './reuse-schema';

export function nutritionHistoryDays(
  endDate: string,
  days: 7 | 30,
  records: { date: string; nutrients: Nutrients; count: number }[]
) {
  const byDate = new Map(records.map((record) => [record.date, record]));
  return Array.from({ length: days }, (_, index) => {
    const date = shiftDiaryDate(endDate, index - days + 1);
    const record = byDate.get(date);
    return {
      date,
      logged: Boolean(record),
      count: record?.count ?? 0,
      nutrients: record?.nutrients ?? null,
    };
  });
}

export const nutritionHistory = {
  async get(userId: string, rawInput: HistoryInput) {
    const input = historyInputSchema.parse(rawInput);
    const startDate = shiftDiaryDate(input.endDate, 1 - input.days);
    // Scalar snapshots allow database aggregation without loading large recipe JSON documents.
    const records = await prisma.nutritionLogEntry.groupBy({
      by: ['logDate'],
      where: { userId, logDate: { gte: diaryDate(startDate), lte: diaryDate(input.endDate) } },
      _sum: { calories: true, protein: true, carbohydrates: true, fat: true, fiber: true },
      _count: { _all: true, fiber: true },
      orderBy: { logDate: 'asc' },
    });
    const days = nutritionHistoryDays(
      input.endDate,
      input.days,
      records.map((record) => ({
        date: record.logDate.toISOString().slice(0, 10),
        count: record._count._all,
        nutrients: {
          calories: record._sum.calories!.toFixed(),
          protein: record._sum.protein!.toFixed(),
          carbohydrates: record._sum.carbohydrates!.toFixed(),
          fat: record._sum.fat!.toFixed(),
          fiber: record._count.fiber === record._count._all ? record._sum.fiber!.toFixed() : null,
        },
      }))
    );
    return {
      startDate,
      endDate: input.endDate,
      days,
      loggedDays: records.length,
      totals: sumNutrition(days.flatMap((day) => (day.nutrients ? [day.nutrients] : []))),
    };
  },
};
