import { createChatPostHandler } from '@/lib/ai-dev/http';
import { productChat } from '@/lib/nutrition/product-chat/service';

export const runtime = 'nodejs';
export const POST = createChatPostHandler(productChat);
