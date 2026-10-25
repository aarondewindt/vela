import { z } from 'zod';
import { protectedProcedure, router } from '@/lib/trpc/server';
import { historyInputSchema } from '@/lib/nutrition/reuse-schema';
import { goalSchema, manualMetricSchema, mappingSchema } from './schema';
import { healthService } from './service';
import { healthChartInputSchema } from './history-range';
export const healthRouter = router({
  getGoal: protectedProcedure.query(({ ctx }) => healthService.getGoal(ctx.userId)),
  diagnostics: protectedProcedure.query(({ ctx }) => healthService.diagnostics(ctx.userId)),
  history: protectedProcedure
    .input(historyInputSchema)
    .query(({ ctx, input }) => healthService.history(ctx.userId, input)),
  chartHistory: protectedProcedure
    .input(healthChartInputSchema)
    .query(({ ctx, input }) => healthService.chartHistory(ctx.userId, input)),
  saveGoal: protectedProcedure
    .input(goalSchema)
    .mutation(({ ctx, input }) => healthService.saveGoal(ctx.userId, input)),
  mappings: protectedProcedure.query(({ ctx }) => healthService.mappings(ctx.userId)),
  saveMappings: protectedProcedure
    .input(mappingSchema)
    .mutation(({ ctx, input }) => healthService.saveMappings(ctx.userId, input)),
  log: protectedProcedure
    .input(manualMetricSchema)
    .mutation(({ ctx, input }) => healthService.log(ctx.userId, input)),
  remove: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => healthService.remove(ctx.userId, input.id)),
});
