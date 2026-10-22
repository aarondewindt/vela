import { protectedProcedure, router } from '@/lib/trpc/server';
import {
  itemIdSchema,
  itemInputSchema,
  itemVersionSchema,
  listItemsSchema,
  quickAddSchema,
  setStatusSchema,
  updateItemSchema,
} from './schema';
import { discoverService } from './service';

export const discoverRouter = router({
  list: protectedProcedure
    .input(listItemsSchema)
    .query(({ ctx, input }) => discoverService.list(ctx.userId, input)),
  types: protectedProcedure.query(({ ctx }) => discoverService.types(ctx.userId)),
  get: protectedProcedure
    .input(itemIdSchema)
    .query(({ ctx, input }) => discoverService.get(ctx.userId, input.id)),
  create: protectedProcedure
    .input(itemInputSchema)
    .mutation(({ ctx, input }) => discoverService.create(ctx.userId, input)),
  quickAdd: protectedProcedure
    .input(quickAddSchema)
    .mutation(({ ctx, input }) => discoverService.create(ctx.userId, input)),
  update: protectedProcedure
    .input(updateItemSchema)
    .mutation(({ ctx, input }) =>
      discoverService.update(ctx.userId, input.id, input.version, input.item)
    ),
  setStatus: protectedProcedure
    .input(setStatusSchema)
    .mutation(({ ctx, input }) =>
      discoverService.setStatus(ctx.userId, input.id, input.version, input.status)
    ),
  refreshMetadata: protectedProcedure
    .input(itemVersionSchema)
    .mutation(({ ctx, input }) =>
      discoverService.refreshMetadata(ctx.userId, input.id, input.version)
    ),
  remove: protectedProcedure
    .input(itemVersionSchema)
    .mutation(({ ctx, input }) => discoverService.remove(ctx.userId, input.id, input.version)),
});
