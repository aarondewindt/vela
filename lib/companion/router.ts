import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '@/lib/trpc/server';
import { historyFilterSchema, uploadFilterSchema } from './schema';
import { deviceOverview, eventDetail, listEvents, listUploads, uploadDetail } from './service';
const procedure = protectedProcedure.use(({ next }) => {
  if (process.env.VELA_PUBLIC_MODE === 'true') {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  return next();
});
export const companionRouter = router({
  devices: procedure.query(({ ctx }) => deviceOverview(ctx.userId)),
  events: procedure
    .input(historyFilterSchema)
    .query(({ ctx, input }) => listEvents(ctx.userId, input)),
  event: procedure
    .input(z.object({ id: z.uuid() }))
    .query(({ ctx, input }) => eventDetail(ctx.userId, input.id)),
  uploads: procedure
    .input(uploadFilterSchema)
    .query(({ ctx, input }) => listUploads(ctx.userId, input)),
  upload: procedure
    .input(z.object({ id: z.uuid() }))
    .query(({ ctx, input }) => uploadDetail(ctx.userId, input.id)),
});
