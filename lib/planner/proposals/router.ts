import { protectedProcedure, router } from '@/lib/trpc/server';
import { createProposalSchema, dateSchema, editSchema, proposalIdSchema } from './schema';
import { proposalService } from './service';
import { generateDaySchema } from '../generation/schema';
import { generateDayPlan } from '../generation/service';

export const proposalRouter = router({
  generate: protectedProcedure
    .input(generateDaySchema)
    .mutation(({ ctx, input }) => generateDayPlan(ctx.userId, input)),
  context: protectedProcedure
    .input(dateSchema)
    .query(({ ctx, input }) => proposalService.context(ctx.userId, input.date)),
  list: protectedProcedure
    .input(dateSchema)
    .query(({ ctx, input }) => proposalService.list(ctx.userId, input.date)),
  get: protectedProcedure
    .input(proposalIdSchema)
    .query(({ ctx, input }) => proposalService.get(ctx.userId, input.id)),
  create: protectedProcedure
    .input(createProposalSchema)
    .mutation(({ ctx, input }) => proposalService.create(ctx.userId, input)),
  createEdit: protectedProcedure
    .input(editSchema)
    .mutation(({ ctx, input }) => proposalService.createEdit(ctx.userId, input)),
  accept: protectedProcedure
    .input(proposalIdSchema)
    .mutation(({ ctx, input }) => proposalService.accept(ctx.userId, input.id)),
  discard: protectedProcedure
    .input(proposalIdSchema)
    .mutation(({ ctx, input }) => proposalService.discard(ctx.userId, input.id)),
});
