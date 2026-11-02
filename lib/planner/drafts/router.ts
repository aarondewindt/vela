import { protectedProcedure, router } from '@/lib/trpc/server';
import {
  applyDraftSchema,
  slotDraftSchema,
  cancelDraftSchema,
  draftCommandSchema,
  draftDateSchema,
} from './schema';
import { draftService } from './service';
import { generateDraftSchema, generateWorkingDraft } from './generation';
import { manualDraftSchema, editWorkingDraft } from './manual';
import { reviewDaySchema } from '../review/schema';
import { reviewDayPlan } from '../review/service';

export const draftRouter = router({
  review: protectedProcedure
    .input(reviewDaySchema.omit({ proposalId: true }))
    .mutation(async ({ ctx, input }) => {
      const { snapshot } = await draftService.snapshot(ctx.userId, input.date, true);
      return reviewDayPlan(ctx.userId, input, snapshot);
    }),
  edit: protectedProcedure
    .input(manualDraftSchema)
    .mutation(({ ctx, input }) => editWorkingDraft(ctx.userId, input)),
  slot: protectedProcedure
    .input(slotDraftSchema)
    .mutation(({ ctx, input }) => draftService.slot(ctx.userId, input)),
  generate: protectedProcedure
    .input(generateDraftSchema)
    .mutation(({ ctx, input }) => generateWorkingDraft(ctx.userId, input)),
  read: protectedProcedure
    .input(draftDateSchema)
    .query(({ ctx, input }) => draftService.read(ctx.userId, input.date)),
  begin: protectedProcedure
    .input(draftCommandSchema)
    .mutation(({ ctx, input }) => draftService.begin(ctx.userId, input)),
  applyChanges: protectedProcedure
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
