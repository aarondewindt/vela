import { z } from 'zod';
import { protectedProcedure, router } from '@/lib/trpc/server';
import { devToolsService } from './service';

const generationInput = z
  .object({
    count: z.number().int().min(1).max(200),
    priorityWeights: z.array(z.number().int().min(0).max(100)).length(5),
    sizeWeights: z.array(z.number().int().min(0).max(100)).length(5),
    noDueDatePercent: z.number().int().min(0).max(100),
    dueDateStartDays: z.number().int().min(-365).max(365),
    dueDateEndDays: z.number().int().min(-365).max(365),
    recurringPercent: z.number().int().min(0).max(100),
    recurringFrequency: z.enum(['DAILY', 'WEEKLY']),
    dependentPercent: z.number().int().min(0).max(100),
  })
  .refine((input) => input.priorityWeights.some((weight) => weight > 0), {
    path: ['priorityWeights'],
    message: 'At least one priority weight must be above zero',
  })
  .refine((input) => input.sizeWeights.some((weight) => weight > 0), {
    path: ['sizeWeights'],
    message: 'At least one size weight must be above zero',
  })
  .refine((input) => input.dueDateStartDays <= input.dueDateEndDays, {
    path: ['dueDateEndDays'],
    message: 'The due date range must start before it ends',
  });

const clearInput = z
  .object({
    createdFrom: z.iso.date().optional(),
    createdTo: z.iso.date().optional(),
  })
  .refine((input) => Boolean(input.createdFrom) === Boolean(input.createdTo), {
    path: ['createdTo'],
    message: 'Choose both dates or leave both empty',
  })
  .refine(
    (input) => !input.createdFrom || !input.createdTo || input.createdFrom <= input.createdTo,
    { path: ['createdTo'], message: 'The date range must start before it ends' }
  );

export const devToolsRouter = router({
  listTestTasks: protectedProcedure.query(({ ctx }) => devToolsService.listTestTasks(ctx.userId)),
  generateTestTasks: protectedProcedure
    .input(generationInput)
    .mutation(({ ctx, input }) => devToolsService.generateTestTasks(ctx.userId, input)),
  clearTestTasks: protectedProcedure
    .input(clearInput)
    .mutation(({ ctx, input }) => devToolsService.clearTestTasks(ctx.userId, input)),
});
