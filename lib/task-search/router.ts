import { z } from 'zod';
import { retrievePlanningTasks } from './retrieval';
import { enqueueTaskIndex } from './queue';
import { prisma } from '@/lib/prisma';
import { TRPCError } from '@trpc/server';
import { AiError } from '@/lib/ai';
import { EmbeddingCollectionError } from '@/lib/embeddings/errors';
import { rebuildSchema, searchSchema } from '@/lib/embeddings/schema';
import { protectedProcedure, router } from '@/lib/trpc/server';
import { taskSearchService } from './service';

async function call<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    if (error instanceof EmbeddingCollectionError) {
      throw new TRPCError({ code: error.code, message: error.message });
    }
    if (error instanceof AiError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    }
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Task search is temporarily unavailable. Please retry.',
    });
  }
}

export const taskSearchRouter = router({
  retrieve: protectedProcedure
    .input(
      z.object({
        query: z.string().trim().min(1).max(2000),
        date: z.iso.date(),
        limit: z.number().int().min(1).max(50).default(30),
        semantic: z.boolean().default(true),
      })
    )
    .query(({ ctx, input }) =>
      call(async () => {
        const result = await retrievePlanningTasks(ctx.userId, input);
        return { ids: result.ids, semantic: result.semantic, warnings: result.warnings };
      })
    ),
  retry: protectedProcedure.mutation(({ ctx }) =>
    call(async () => {
      await enqueueTaskIndex(prisma, ctx.userId);
      return { queued: true };
    })
  ),
  status: protectedProcedure.query(({ ctx }) => call(() => taskSearchService.status(ctx.userId))),
  models: protectedProcedure.query(() => call(() => taskSearchService.models())),
  index: protectedProcedure.mutation(({ ctx }) =>
    call(() => taskSearchService.synchronize(ctx.userId))
  ),
  rebuild: protectedProcedure
    .input(rebuildSchema)
    .mutation(({ ctx, input }) =>
      call(() => taskSearchService.rebuild(ctx.userId, input.selection, input.queryInstruction))
    ),
  search: protectedProcedure
    .input(searchSchema)
    .mutation(({ ctx, input }) =>
      call(() => taskSearchService.search(ctx.userId, input.query, input.limit))
    ),
});
