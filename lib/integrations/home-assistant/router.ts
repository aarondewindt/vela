import { protectedProcedure, router } from '@/lib/trpc/server';
import { connectionSchema, homeAssistantService } from './service';
export const homeAssistantRouter = router({
  get: protectedProcedure.query(({ ctx }) => homeAssistantService.get(ctx.userId)),
  save: protectedProcedure
    .input(connectionSchema)
    .mutation(({ ctx, input }) => homeAssistantService.save(ctx.userId, input)),
  entities: protectedProcedure.query(({ ctx }) => homeAssistantService.entities(ctx.userId)),
});
