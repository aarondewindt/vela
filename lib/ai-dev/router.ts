import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '@/lib/trpc/server';
import { getAiDevError } from './errors';
import { aiDevService } from './service';
import { conversationService } from './conversations';
import { conversationIdSchema, selectionSchema } from './schema';

async function call<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    const failure = getAiDevError(error);
    throw new TRPCError({
      code: failure.status === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
      message: failure.message,
    });
  }
}

export const aiDevRouter = router({
  listChatModels: protectedProcedure.query(() => call(() => aiDevService.listChatModels())),
  listConversations: protectedProcedure.query(({ ctx }) =>
    call(() => conversationService.list(ctx.userId))
  ),
  createConversation: protectedProcedure
    .input(selectionSchema)
    .mutation(({ ctx, input }) => call(() => conversationService.create(ctx.userId, input))),
  getConversation: protectedProcedure
    .input(conversationIdSchema)
    .query(({ ctx, input }) => call(() => conversationService.get(ctx.userId, input.id))),
  deleteConversation: protectedProcedure
    .input(conversationIdSchema)
    .mutation(({ ctx, input }) => call(() => conversationService.delete(ctx.userId, input.id))),
});
