import { createChatPostHandler } from '@/lib/ai-dev/http';
import { aiDevService } from '@/lib/ai-dev/service';

export const runtime = 'nodejs';
export const POST = createChatPostHandler(aiDevService);
