import { protectedProcedure, router } from '@/lib/trpc/server';
import {
  createProposalSchema,
  dateSchema,
  editSchema,
  proposalIdSchema,
  replanSchema,
} from './schema';
import { proposalService } from './service';
import { generateDaySchema } from '../generation/schema';
import { generateDayPlan } from '../generation/service';
import { reviewDaySchema } from '../review/schema';
import { reviewDayPlan } from '../review/service';

export const proposalRouter = router({
  review: protectedProcedure
    .input(reviewDaySchema)
    .mutation(({ ctx, input }) => reviewDayPlan(ctx.userId, input)),
  generate: protectedProcedure
    .input(generateDaySchema)
    .mutation(({ ctx, input }) => generateDayPlan(ctx.userId, input)),
  replan: protectedProcedure
    .input(replanSchema)
    .mutation(({ ctx, input }) => proposalService.replan(ctx.userId, input)),
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
