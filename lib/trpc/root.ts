import { plannerRouter } from '@/lib/planner/router';
import { router } from './server';

export const appRouter = router({
  planner: plannerRouter,
});

export type AppRouter = typeof appRouter;
