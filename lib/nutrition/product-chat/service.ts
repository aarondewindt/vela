import 'server-only';
import { createConversationService } from '@/lib/ai-dev/conversations';
import { createChatService } from '@/lib/ai-dev/service';

export const productConversations = createConversationService('nutrition-product');
export const productChat = createChatService(productConversations);
