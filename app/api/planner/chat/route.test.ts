/** @jest-environment node */

jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('@/lib/ai', () => jest.requireActual('@/lib/ai/errors'));
jest.mock('@/lib/planner/chat/service', () => ({ streamPlannerChat: jest.fn() }));

import { TRPCError } from '@trpc/server';
import { auth } from '@/lib/auth';
import { AiError } from '@/lib/ai';
import { streamPlannerChat } from '@/lib/planner/chat/service';
import { POST } from './route';

const body = {
  date: '2026-10-24',
  conversationId: '45f6af99-9a30-4638-b05f-fb826b970379',
  message: { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
};
function request(value: unknown = body, headers?: HeadersInit) {
  return new Request('http://localhost:3000/api/planner/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(value),
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  (auth.api.getSession as unknown as jest.Mock).mockResolvedValue({ user: { id: 'user-a' } });
});

describe('Planner chat endpoint', () => {
  it('authenticates before parsing input or calling AI', async () => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValue(null);
    const response = await POST(request(null));
    expect(response.status).toBe(401);
    expect(streamPlannerChat).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin request', async () => {
    expect((await POST(request(body, { origin: 'https://other.test' }))).status).toBe(403);
    expect(streamPlannerChat).not.toHaveBeenCalled();
  });

  it('requires JSON content', async () => {
    expect((await POST(request(body, { 'Content-Type': 'text/plain' }))).status).toBe(415);
  });

  it('accepts the external host when Next.js uses an internal request URL', async () => {
    const stream = new Response('stream');
    (streamPlannerChat as jest.Mock).mockResolvedValue(stream);
    await expect(
      POST(request(body, { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }))
    ).resolves.toBe(stream);
  });

  it('rejects cross-site browser requests even when the host matches', async () => {
    expect(
      (
        await POST(
          request(body, { origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' })
        )
      ).status
    ).toBe(403);
    expect(streamPlannerChat).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const response = await POST(
      new Request('http://localhost:3000/api/planner/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      })
    );
    expect(response.status).toBe(400);
    expect(streamPlannerChat).not.toHaveBeenCalled();
  });

  it('validates message parts before invoking the service', async () => {
    const response = await POST(
      request({ ...body, message: { id: 'u', role: 'user', parts: [{ type: 'file' }] } })
    );
    expect(response.status).toBe(400);
    expect(streamPlannerChat).not.toHaveBeenCalled();
  });

  it('returns the service stream and passes request cancellation', async () => {
    const stream = new Response('data: test\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
    (streamPlannerChat as jest.Mock).mockResolvedValue(stream);
    const req = request(body, { origin: 'http://localhost:3000' });
    await expect(POST(req)).resolves.toBe(stream);
    expect(streamPlannerChat).toHaveBeenCalledWith('user-a', body, req.signal);
    expect(auth.api.getSession).toHaveBeenCalledWith({ headers: req.headers });
  });

  it.each([
    { code: 'MODEL_NOT_FOUND', status: 400 },
    { code: 'MODEL_NOT_SUPPORTED', status: 400 },
    { code: 'PROVIDER_UNAVAILABLE', status: 503 },
    { code: 'CONFIGURATION_ERROR', status: 503 },
    { code: 'INVALID_PROVIDER_RESPONSE', status: 502 },
  ] as const)('returns a meaningful error for $code', async ({ code, status }) => {
    (streamPlannerChat as jest.Mock).mockRejectedValue(new AiError(code, 'Safe provider message'));
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.text()).toBe('Safe provider message');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('does not expose unexpected provider failures', async () => {
    (streamPlannerChat as jest.Mock).mockRejectedValue(new Error('private request payload'));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private');
  });

  it('does not expose session backend failures', async () => {
    (auth.api.getSession as unknown as jest.Mock).mockRejectedValue(
      new Error('private database connection')
    );
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private');
    expect(streamPlannerChat).not.toHaveBeenCalled();
  });
});

it('returns not found when the authenticated user does not own the conversation', async () => {
  (streamPlannerChat as jest.Mock).mockRejectedValue(
    new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found.' })
  );
  expect((await POST(request())).status).toBe(404);
});

it('rejects requests without a selected planning date', async () => {
  expect((await POST(request({ ...body, date: undefined }))).status).toBe(400);
  expect(streamPlannerChat).not.toHaveBeenCalled();
});
