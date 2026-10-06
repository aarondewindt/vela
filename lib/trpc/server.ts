import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { auth } from '@/lib/auth';

export async function createTRPCContext({ req }: { req: Request }) {
  const session = await auth.api.getSession({ headers: req.headers });

  return { userId: session?.user.id ?? null };
}

const t = initTRPC
  .context<Awaited<ReturnType<typeof createTRPCContext>>>()
  .create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  return next({ ctx: { userId: ctx.userId } });
});
