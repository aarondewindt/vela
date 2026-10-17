import { plannerRouter } from '@/lib/planner/router';
import { settingsRouter } from '@/lib/settings/router';
import { devToolsRouter } from '@/lib/dev-tools/router';
import { aiDevRouter } from '@/lib/ai-dev/router';
import { taskSearchRouter } from '@/lib/task-search/router';
import { router } from './server';

export const appRouter = router({
  planner: plannerRouter,
  settings: settingsRouter,
  devTools: devToolsRouter,
  aiDev: aiDevRouter,
  taskSearch: taskSearchRouter,
});

export type AppRouter = typeof appRouter;
