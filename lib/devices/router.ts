import { z } from 'zod';
import { protectedProcedure, router } from '@/lib/trpc/server';
import { approvePairing, listDevices, reviewPairing, revokeDevice } from './service';
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-F0-9]{12}$/);
export const devicesRouter = router({
  list: protectedProcedure.query(({ ctx }) => listDevices(ctx.userId)),
  review: protectedProcedure
    .input(z.object({ code }))
    .mutation(({ ctx, input }) => reviewPairing(ctx.userId, input.code)),
  approve: protectedProcedure
    .input(z.object({ code }))
    .mutation(({ ctx, input }) => approvePairing(ctx.userId, input.code)),
  revoke: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => revokeDevice(ctx.userId, input.id)),
});
