import { z } from 'zod';
import { protectedProcedure, router } from '@/lib/trpc/server';
import { acceptSchema, turnSchema, changeModelSchema } from './schema';
import { conversationService } from './service';

export const conversationRouter = router({
  changeModel: protectedProcedure
    .input(changeModelSchema)
    .mutation(({ ctx, input }) => conversationService.changeModel(ctx.userId, input)),
  create: protectedProcedure.mutation(({ ctx }) => conversationService.create(ctx.userId)),
  list: protectedProcedure.query(({ ctx }) => conversationService.list(ctx.userId)),
  get: protectedProcedure
    .input(z.object({ id: z.uuid() }).strict())
    .query(({ ctx, input }) => conversationService.get(ctx.userId, input.id)),
  send: protectedProcedure
    .input(turnSchema)
    .mutation(({ ctx, input }) => conversationService.send(ctx.userId, input)),
  discard: protectedProcedure
    .input(z.object({ conversationId: z.uuid(), turnId: z.uuid() }).strict())
    .mutation(({ ctx, input }) => conversationService.discard(ctx.userId, input)),
  accept: protectedProcedure
    .input(acceptSchema)
    .mutation(({ ctx, input }) => conversationService.accept(ctx.userId, input)),
});
