import { homeAssistantRouter } from '@/lib/integrations/home-assistant/router';
import { healthRouter } from '@/lib/health/router';
import { proposalRouter } from '@/lib/planner/proposals/router';
import { plannerRouter } from '@/lib/planner/router';
import { settingsRouter } from '@/lib/settings/router';
import { devToolsRouter } from '@/lib/dev-tools/router';
import { aiDevRouter } from '@/lib/ai-dev/router';
import { taskSearchRouter } from '@/lib/task-search/router';
import { nutritionRouter } from '@/lib/nutrition/router';
import { taskReviewRouter } from '@/lib/task-reviews/router';
import { router } from './server';

export const appRouter = router({
  planner: plannerRouter,
  taskReviews: taskReviewRouter,
  planningProposals: proposalRouter,
  settings: settingsRouter,
  devTools: devToolsRouter,
  aiDev: aiDevRouter,
  taskSearch: taskSearchRouter,
  nutrition: nutritionRouter,
  homeAssistant: homeAssistantRouter,
  health: healthRouter,
});

export type AppRouter = typeof appRouter;
