import { z } from 'zod';
import { extractProduct } from '../product-extraction/service';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '@/lib/trpc/server';
import { getAiDevError } from '@/lib/ai-dev/errors';
import {
  chatInputSchema,
  conversationIdSchema,
  createProductConversationSchema,
  changeConversationStageModelSchema,
  changeConversationModelSchema,
} from '@/lib/ai-dev/schema';
import { productConversations, productChat } from './service';

async function call<T>(operation: () => Promise<T>) {
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
const productReference = z.object({ productId: z.uuid() });
export const productChatRouter = router({
  extract: protectedProcedure
    .input(chatInputSchema)
    .mutation(({ ctx, input }) => call(() => extractProduct(ctx.userId, input, ctx.signal))),
  listChatModels: protectedProcedure.query(() => call(() => productChat.listChatModels())),
  listConversations: protectedProcedure.query(({ ctx }) =>
    call(() => productConversations.list(ctx.userId))
  ),
  createConversation: protectedProcedure
    .input(createProductConversationSchema)
    .mutation(({ ctx, input }) =>
      call(() => productConversations.create(ctx.userId, input.selection, input.stageOverrides))
    ),
  getConversation: protectedProcedure
    .input(conversationIdSchema)
    .query(({ ctx, input }) => call(() => productConversations.get(ctx.userId, input.id))),
  changeConversationModel: protectedProcedure
    .input(changeConversationModelSchema)
    .mutation(({ ctx, input }) =>
      call(() => productConversations.changeModel(ctx.userId, input.id, input.selection))
    ),
  changeConversationStageModel: protectedProcedure
    .input(changeConversationStageModelSchema)
    .mutation(({ ctx, input }) =>
      call(() =>
        productConversations.changeStageModel(ctx.userId, input.id, input.stage, input.selection)
      )
    ),
  deleteConversation: protectedProcedure
    .input(conversationIdSchema)
    .mutation(({ ctx, input }) => call(() => productConversations.delete(ctx.userId, input.id))),
  listForProduct: protectedProcedure
    .input(productReference)
    .query(({ ctx, input }) =>
      call(() => productConversations.listForProduct(ctx.userId, input.productId))
    ),
  linkProduct: protectedProcedure
    .input(productReference.extend({ id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      call(() => productConversations.linkProduct(ctx.userId, input.id, input.productId))
    ),
});
