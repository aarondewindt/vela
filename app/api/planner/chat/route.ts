import { auth } from '@/lib/auth';
import { getAiDevError } from '@/lib/ai-dev/errors';
import { plannerChatInputSchema as chatInputSchema } from '@/lib/planner/chat/schema';
import { streamPlannerChat } from '@/lib/planner/chat/service';

export const runtime = 'nodejs';

function failure(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return failure('Sign in to use Planner chat.', 401);
    }

    const origin = request.headers.get('origin');
    // Next.js can construct request.url with its internal listening hostname.
    const host = request.headers.get('host') ?? new URL(request.url).host;
    if (
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      (origin && origin !== `http://${host}` && origin !== `https://${host}`)
    ) {
      return failure('Chat requests must come from this site.', 403);
    }
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
      return failure('Send a JSON chat request.', 415);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return failure('The chat request is not valid JSON.', 400);
    }
    const input = chatInputSchema.safeParse(body);
    if (!input.success) {
      return failure(input.error.issues[0]?.message ?? 'The chat request is invalid.', 400);
    }

    return await streamPlannerChat(session.user.id, input.data, request.signal);
  } catch (error) {
    const { message, status } = getAiDevError(error);
    return failure(message, status);
  }
}
