import { protectedProcedure, router } from '@/lib/trpc/server';
import { applyDraftSchema, cancelDraftSchema, draftCommandSchema, draftDateSchema } from './schema';
import { draftService } from './service';

export const draftRouter = router({
  read: protectedProcedure
    .input(draftDateSchema)
    .query(({ ctx, input }) => draftService.read(ctx.userId, input.date)),
  begin: protectedProcedure
    .input(draftCommandSchema)
    .mutation(({ ctx, input }) => draftService.begin(ctx.userId, input)),
  apply: protectedProcedure
    .input(applyDraftSchema)
    .mutation(({ ctx, input }) => draftService.apply(ctx.userId, input)),
  undo: protectedProcedure
    .input(draftCommandSchema)
    .mutation(({ ctx, input }) => draftService.history(ctx.userId, input, 'undo')),
  redo: protectedProcedure
    .input(draftCommandSchema)
    .mutation(({ ctx, input }) => draftService.history(ctx.userId, input, 'redo')),
  refresh: protectedProcedure
    .input(draftCommandSchema)
    .mutation(({ ctx, input }) => draftService.refresh(ctx.userId, input)),
  accept: protectedProcedure
    .input(draftCommandSchema)
    .mutation(({ ctx, input }) => draftService.accept(ctx.userId, input)),
  cancel: protectedProcedure
    .input(cancelDraftSchema)
    .mutation(({ ctx, input }) => draftService.cancel(ctx.userId, input)),
});
