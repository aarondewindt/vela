import 'server-only';
import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '../../generated/prisma/client';
import { readMealPreferences, saveMealPreferencesSchema } from './meals';
import type { z } from 'zod';

export const mealService = {
  async get(userId: string) {
    const settings = await prisma.plannerGenerationSettings.findUnique({ where: { userId } });
    return {
      preferences: readMealPreferences(settings?.mealPreferences),
      version: settings?.mealVersion ?? 0,
    };
  },
  async save(userId: string, raw: z.input<typeof saveMealPreferencesSchema>) {
    const input = saveMealPreferencesSchema.parse(raw);
    return prisma
      .$transaction(async (tx) => {
        // Empty update preserves other planner settings and lets concurrent first saves
        // contend on the same row before applying the version check.
        await tx.plannerGenerationSettings.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });
        const result = await tx.plannerGenerationSettings.updateMany({
          where: { userId, mealVersion: input.version },
          data: { mealPreferences: input.preferences, mealVersion: { increment: 1 } },
        });
        if (!result.count) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Meal preferences changed. Reload before saving again.',
          });
        }
        return { preferences: input.preferences, version: input.version + 1 };
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Meal preferences changed. Reload before saving again.',
          });
        }
        throw error;
      });
  },
};
