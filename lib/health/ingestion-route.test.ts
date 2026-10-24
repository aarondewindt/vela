/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/devices/service', () => ({ requireDevice: jest.fn() }));
jest.mock('./ingestion', () => ({ ingestHealth: jest.fn() }));
import { TRPCError } from '@trpc/server';
import { requireDevice } from '@/lib/devices/service';
import { ingestHealth } from './ingestion';
import { POST } from '@/app/api/health/ingest/route';
const request = (body = '{}') =>
  new Request('https://vela.example/api/health/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body,
  });
beforeEach(() => {
  jest.clearAllMocks();
  process.env.BETTER_AUTH_URL = 'https://vela.example';
});
it.each(['UNAUTHORIZED', 'FORBIDDEN'] as const)(
  'rejects invalid/revoked credentials or missing scope: %s',
  async (code) => {
    (requireDevice as jest.Mock).mockRejectedValue(new TRPCError({ code }));
    expect((await POST(request())).status).toBe(code === 'UNAUTHORIZED' ? 401 : 403);
    expect(ingestHealth).not.toHaveBeenCalled();
  }
);
it('uses the authenticated owner/device and health:write scope', async () => {
  (requireDevice as jest.Mock).mockResolvedValue({ userId: 'alice', credentialId: 'phone' });
  (ingestHealth as jest.Mock).mockResolvedValue({ results: [] });
  const response = await POST(request());
  expect(requireDevice).toHaveBeenCalledWith(expect.any(Headers), ['health:write']);
  expect(ingestHealth).toHaveBeenCalledWith('alice', 'phone', {});
  expect(response.headers.get('cache-control')).toBe('no-store');
});
it('bounds requests and rejects malformed JSON before persistence', async () => {
  (requireDevice as jest.Mock).mockResolvedValue({ userId: 'alice', credentialId: 'phone' });
  expect((await POST(request('x'.repeat(65537)))).status).toBe(413);
  expect((await POST(request('{'))).status).toBe(400);
  expect(ingestHealth).not.toHaveBeenCalled();
});
