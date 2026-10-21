import 'server-only';
import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import { goalsInputSchema, nutritionGoalOptionsSchema, type GoalsInput } from './diary-schema';

export const nutritionGoals = {
  async get(userId: string) {
    const goals = await prisma.nutritionGoals.findUnique({ where: { userId } });
    return {
      semantics: nutritionGoalOptionsSchema.parse(goals?.semantics ?? {}),
      calories: goals?.calories?.toFixed() ?? null,
      protein: goals?.protein?.toFixed() ?? null,
      carbohydrates: goals?.carbohydrates?.toFixed() ?? null,
      fat: goals?.fat?.toFixed() ?? null,
      fiber: goals?.fiber?.toFixed() ?? null,
      version: goals?.version ?? 0,
    };
  },

  async save(userId: string, rawInput: GoalsInput) {
    const { version, semantics, ...amounts } = goalsInputSchema.parse(rawInput);
    return prisma.$transaction(async (db) => {
      const current =
        version === 0 ? null : await db.nutritionGoals.findUnique({ where: { userId } });
      const options = semantics ?? nutritionGoalOptionsSchema.parse(current?.semantics ?? {});
      goalsInputSchema.parse({
        ...amounts,
        fiber: amounts.fiber === undefined ? (current?.fiber?.toFixed() ?? null) : amounts.fiber,
        version,
        semantics: options,
      });
      const data = { ...amounts, semantics: options };
      if (version === 0) {
        try {
          await db.nutritionGoals.create({ data: { ...data, userId } });
        } catch (error) {
          if ((error as { code?: string }).code !== 'P2002') {
            throw error;
          }
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Your goals changed. Reload them before saving again.',
          });
        }
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
        semantics: nutritionGoalOptionsSchema.parse(saved.semantics ?? {}),
        calories: saved.calories?.toFixed() ?? null,
        protein: saved.protein?.toFixed() ?? null,
        carbohydrates: saved.carbohydrates?.toFixed() ?? null,
        fat: saved.fat?.toFixed() ?? null,
        fiber: saved.fiber?.toFixed() ?? null,
        version: saved.version,
      };
    });
  },
};
