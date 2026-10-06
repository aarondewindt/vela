import { z } from 'zod';
import { protectedProcedure, router } from '@/lib/trpc/server';
import { plannerService } from './service';

export const plannerRouter = router({
  listTasks: protectedProcedure.query(({ ctx }) => plannerService.listTasks(ctx.userId)),
  createTask: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(240),
        brief: z.string().optional(),
      })
    )
    .mutation(({ ctx, input }) => plannerService.createTask(ctx.userId, input)),
  getPlan: protectedProcedure
    .input(z.object({ date: z.iso.date() }))
    .query(({ ctx, input }) => plannerService.getPlan(ctx.userId, input.date)),
});
