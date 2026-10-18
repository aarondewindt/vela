import 'server-only';
import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import { goalsInputSchema, type GoalsInput } from './diary-schema';

export const nutritionGoals = {
  async get(userId: string) {
    const goals = await prisma.nutritionGoals.findUnique({ where: { userId } });
    return {
      calories: goals?.calories?.toFixed() ?? null,
      protein: goals?.protein?.toFixed() ?? null,
      carbohydrates: goals?.carbohydrates?.toFixed() ?? null,
      fat: goals?.fat?.toFixed() ?? null,
      version: goals?.version ?? 0,
    };
  },

  async save(userId: string, rawInput: GoalsInput) {
    const { version, ...data } = goalsInputSchema.parse(rawInput);
    return prisma.$transaction(async (db) => {
      if (version === 0) {
        await db.nutritionGoals.create({ data: { ...data, userId } });
      } else {
        const result = await db.nutritionGoals.updateMany({
          where: { userId, version },
          data: { ...data, version: { increment: 1 } },
        });
        if (!result.count) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Your goals changed. Reload them before saving again.',
          });
        }
      }
      const saved = await db.nutritionGoals.findUniqueOrThrow({ where: { userId } });
      return {
        calories: saved.calories?.toFixed() ?? null,
        protein: saved.protein?.toFixed() ?? null,
        carbohydrates: saved.carbohydrates?.toFixed() ?? null,
        fat: saved.fat?.toFixed() ?? null,
        version: saved.version,
      };
    });
  },
};
