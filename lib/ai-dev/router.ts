import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '@/lib/trpc/server';
import { getAiDevError } from './errors';
import { aiDevService } from './service';

export const aiDevRouter = router({
  listChatModels: protectedProcedure.query(async () => {
    try {
      return await aiDevService.listChatModels();
    } catch (error) {
      const failure = getAiDevError(error);
      throw new TRPCError({
        code: failure.status === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
        message: failure.message,
      });
    }
  }),
});
