import { plannerRouter } from '@/lib/planner/router';
import { settingsRouter } from '@/lib/settings/router';
import { router } from './server';

export const appRouter = router({
  planner: plannerRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
