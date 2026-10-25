import { evaluateGoal, readGoalOptions } from '@/lib/goals/semantics';
import 'server-only';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { diaryDate } from '@/lib/nutrition/dates';
import { nutritionHistory } from '@/lib/nutrition/history';
import { historyInputSchema } from '@/lib/nutrition/reuse-schema';
import {
  goalSchema,
  manualMetricSchema,
  mappingSchema,
  metricKinds,
  haMetricKinds,
  metricGoalsSchema,
} from './schema';
import { ownerClient } from '@/lib/integrations/home-assistant/service';
import { HomeAssistantError } from '@/lib/integrations/home-assistant/client';
import { settingsService } from '@/lib/settings/service';
import { calorieBalance, inspectMetric } from './normalization';
import { readHealthMetrics } from './persistence';
import { healthChartHistory } from './history';

export const healthService = {
  chartHistory: healthChartHistory,
  async getGoal(userId: string) {
    const goal = await prisma.healthGoal.findUnique({ where: { userId } });
    return {
      semantics: readGoalOptions(goal?.semantics),
      metricGoals: metricGoalsSchema.parse(goal?.metricGoals ?? {}),
      calorieBalance: goal?.calorieBalance ?? null,
      version: goal?.version ?? 0,
    };
  },
  async diagnostics(userId: string) {
    try {
      const [{ client }, mappings, { timezone }] = await Promise.all([
        ownerClient(userId),
        prisma.healthEntityMapping.findMany({
          where: { userId, metric: { in: [...haMetricKinds] } },
          select: { metric: true, entityId: true },
        }),
        settingsService.getPreferences(userId),
      ]);
      const states = await client.states();
      return {
        checkedAt: new Date(),
        timezone,
        sensors: mappings.map((mapping) => {
          const state = states.find((item) => item.entity_id === mapping.entityId);
          const result = state ? inspectMetric(mapping.metric, state, timezone) : null;
          return {
            ...mapping,
            state: state?.state ?? null,
            unit:
              typeof state?.attributes.unit_of_measurement === 'string'
                ? state.attributes.unit_of_measurement
                : null,
            lastChanged: state?.last_changed ?? null,
            lastUpdated: state?.last_updated ?? null,
            issue: state
              ? result!.issue
              : 'Entity not found in Home Assistant. Check the saved entity ID, whether it is enabled, and the token permissions.',
            normalized: result?.normalized
              ? { value: result.normalized.value, date: result.normalized.date }
              : null,
          };
        }),
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message:
          error instanceof HomeAssistantError
            ? error.message
            : 'Could not inspect mapped sensors. Check the connection configuration and Home Assistant response format.',
      });
    }
  },
  async history(userId: string, input: z.infer<typeof historyInputSchema>) {
    const nutrition = await nutritionHistory.get(userId, input);
    const [records, goal] = await Promise.all([
      readHealthMetrics(userId, nutrition.startDate, input.endDate),
      prisma.healthGoal.findUnique({ where: { userId } }),
    ]);
    const recordsByDate = new Map<string, typeof records>();
    for (const record of records) {
      const date = record.date.toISOString().slice(0, 10);
      const entries = recordsByDate.get(date) ?? [];
      entries.push(record);
      recordsByDate.set(date, entries);
    }
    const carried = new Map(
      records.filter((x) => x.date < diaryDate(nutrition.startDate)).map((x) => [x.metric, x])
    );
    const goalOptions = readGoalOptions(goal?.semantics);
    return {
      goal: {
        semantics: goalOptions,
        metricGoals: metricGoalsSchema.parse(goal?.metricGoals ?? {}),
        calorieBalance: goal?.calorieBalance ?? null,
        version: goal?.version ?? 0,
      },
      days: nutrition.days.map((day) => {
        const entries = recordsByDate.get(day.date) ?? [];
        const metrics = Object.fromEntries(
          metricKinds.map((metric) => {
            const measured = entries.find((x) => x.metric === metric);
            const record =
              measured ??
              (['WEIGHT', 'BODY_FAT', 'LEAN_MASS', 'BMR'].includes(metric)
                ? carried.get(metric)
                : undefined);
            if (measured) {
              carried.set(metric, measured);
            }
            return [
              metric,
              record
                ? {
                    id: record.id,
                    value: Number(record.value),
                    measurementDate: record.date.toISOString().slice(0, 10),
                    carriedForward: !measured,
                    observedAt: record.observedAt,
                    source: record.source,
                    entityId: record.entityId,
                    timestampBasis: record.timestampBasis,
                    metadata: record.metadata,
                  }
                : null,
            ];
          })
        ) as Record<
          (typeof metricKinds)[number],
          {
            id: string;
            value: number;
            measurementDate: string;
            carriedForward: boolean;
            observedAt: Date;
            source: string;
            entityId: string | null;
            timestampBasis: string;
            metadata?: unknown;
          } | null
        >;
        const intake = day.nutrients ? Number(day.nutrients.calories) : null;
        const burned = metrics.TOTAL_CALORIES?.value ?? null;
        return {
          date: day.date,
          metrics,
          intake,
          burned,
          ...calorieBalance(
            intake,
            burned,
            (goalOptions.kind === 'range' || goalOptions.kind === 'minimum') &&
              goalOptions.preferredTarget !== undefined
              ? Number(goalOptions.preferredTarget)
              : (goal?.calorieBalance ?? null)
          ),
          goalEvaluation: evaluateGoal(
            calorieBalance(intake, burned, null).balance?.toString() ?? null,
            goal?.calorieBalance?.toString() ?? null,
            goalOptions
          ),
        };
      }),
    };
  },
  async saveGoal(userId: string, input: z.infer<typeof goalSchema>) {
    const { version, calorieBalance: balance, semantics, metricGoals } = goalSchema.parse(input);
    const options =
      semantics ??
      readGoalOptions(
        version === 0
          ? null
          : (await prisma.healthGoal.findUnique({ where: { userId } }))?.semantics
      );
    goalSchema.parse({ version, calorieBalance: balance, semantics: options });
    if (!version) {
      try {
        return await prisma.healthGoal.create({
          data: { userId, calorieBalance: balance, semantics: options, metricGoals },
        });
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') {
          throw error;
        }
        throw new TRPCError({ code: 'CONFLICT', message: 'Goal changed. Reload before saving.' });
      }
    }
    const result = await prisma.healthGoal.updateMany({
      where: { userId, version },
      data: {
        calorieBalance: balance,
        semantics: options,
        ...(metricGoals === undefined ? {} : { metricGoals }),
        version: { increment: 1 },
      },
    });
    if (!result.count) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Goal changed. Reload before saving.' });
    }
    return { saved: true };
  },
  mappings(userId: string) {
    return prisma.healthEntityMapping.findMany({
      where: { userId, metric: { in: [...haMetricKinds] } },
      select: { metric: true, entityId: true },
    });
  },
  async saveMappings(userId: string, input: z.infer<typeof mappingSchema>) {
    const mappings = mappingSchema.parse(input);
    return prisma.$transaction(async (db) => {
      const connection = await db.homeAssistantConnection.updateMany({
        where: { userId },
        data: {
          revision: { increment: 1 },
          status: 'Mappings changed; waiting for worker',
          lastSyncedAt: null,
        },
      });
      if (!connection.count) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Configure your Home Assistant connection first.',
        });
      }
      await db.healthEntityMapping.deleteMany({ where: { userId } });
      await db.healthEntityMapping.createMany({ data: mappings.map((x) => ({ ...x, userId })) });
      return { saved: true };
    });
  },
  async log(userId: string, input: z.infer<typeof manualMetricSchema>) {
    const parsed = manualMetricSchema.parse(input);
    const sourceKey = `manual:${parsed.requestId}`;
    const existing = await prisma.healthMetric.findUnique({
      where: { userId_sourceKey: { userId, sourceKey } },
    });
    if (existing) {
      if (
        existing.metric !== parsed.metric ||
        existing.date.toISOString().slice(0, 10) !== parsed.date ||
        Number(existing.value) !== parsed.value
      ) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This request already saved a different measurement.',
        });
      }
      return { saved: true };
    }
    const saved = await prisma.healthMetric.upsert({
      where: { userId_sourceKey: { userId, sourceKey } },
      create: {
        userId,
        sourceKey,
        metric: parsed.metric,
        value: parsed.value,
        date: diaryDate(parsed.date),
        observedAt: new Date(),
        source: 'manual',
        timestampBasis: 'user_date',
      },
      update: {},
    });
    if (
      saved.metric !== parsed.metric ||
      saved.date.toISOString().slice(0, 10) !== parsed.date ||
      Number(saved.value) !== parsed.value
    ) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'This request already saved a different measurement.',
      });
    }
    return { saved: true };
  },
  async remove(userId: string, id: string) {
    const result = await prisma.healthMetric.deleteMany({
      where: { userId, id, source: 'manual' },
    });
    if (!result.count) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Manual measurement not found.' });
    }
    return { removed: true };
  },
};
