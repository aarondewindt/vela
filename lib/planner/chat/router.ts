import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '@/lib/trpc/server';
import { getAiDevError } from '@/lib/ai-dev/errors';
import { aiDevService } from '@/lib/ai-dev/service';
import { plannerChatConversations as conversationService } from './service';
import {
  conversationIdSchema,
  createConversationSchema,
  changeConversationModelSchema,
} from '@/lib/ai-dev/schema';

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

export const plannerChatRouter = router({
  listChatModels: protectedProcedure.query(() => call(() => aiDevService.listChatModels())),
  listConversations: protectedProcedure.query(({ ctx }) =>
    call(() => conversationService.list(ctx.userId))
  ),
  createConversation: protectedProcedure
    .input(createConversationSchema)
    .mutation(({ ctx, input }) =>
      call(() => conversationService.create(ctx.userId, input.selection))
    ),
  changeConversationModel: protectedProcedure
    .input(changeConversationModelSchema)
    .mutation(({ ctx, input }) =>
      call(() => conversationService.changeModel(ctx.userId, input.id, input.selection))
    ),
  getConversation: protectedProcedure
    .input(conversationIdSchema)
    .query(({ ctx, input }) => call(() => conversationService.get(ctx.userId, input.id))),
  deleteConversation: protectedProcedure
    .input(conversationIdSchema)
    .mutation(({ ctx, input }) => call(() => conversationService.delete(ctx.userId, input.id))),
});
