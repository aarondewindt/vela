import { protectedProcedure, router } from '@/lib/trpc/server';
import { acceptReviewInput, taskReviewInput } from './schema';
import { taskReviewService } from './service';

export const taskReviewRouter = router({
  latest: protectedProcedure
    .input(taskReviewInput)
    .query(({ ctx, input }) => taskReviewService.latest(ctx.userId, input)),
  generate: protectedProcedure
    .input(taskReviewInput)
    .mutation(({ ctx, input }) => taskReviewService.generate(ctx.userId, input)),
  accept: protectedProcedure
    .input(acceptReviewInput)
    .mutation(({ ctx, input }) => taskReviewService.accept(ctx.userId, input)),
});
