import { companionRouter } from '@/lib/companion/router';
import { plannerChatRouter } from '@/lib/planner/chat/router';
import { devicesRouter } from '@/lib/devices/router';
import { conversationRouter } from '@/lib/planner/conversation/router';
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
import { discoverRouter } from '@/lib/discover/router';

export const appRouter = router({
  companion: companionRouter,
  plannerChat: plannerChatRouter,
  devices: devicesRouter,
  discover: discoverRouter,
  planner: plannerRouter,
  plannerConversation: conversationRouter,
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
