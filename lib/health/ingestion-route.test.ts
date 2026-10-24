/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/devices/service', () => ({ requireDevice: jest.fn() }));
jest.mock('./ingestion', () => ({ ...jest.requireActual('./ingestion'), ingestHealth: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    companionEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'audit' }),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    companionUpload: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  },
}));
import { TRPCError } from '@trpc/server';
import { requireDevice } from '@/lib/devices/service';
import { ingestHealth } from './ingestion';
import { prisma } from '@/lib/prisma';
import { healthFixture } from '@/lib/companion/fixtures';
import { POST } from '@/app/api/health/ingest/route';
const request = (body = JSON.stringify(healthFixture)) =>
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
  (requireDevice as jest.Mock).mockResolvedValue({
    userId: 'alice',
    credentialId: 'phone',
    scopes: ['health:write'],
  });
  (ingestHealth as jest.Mock).mockResolvedValue({ results: [] });
  const response = await POST(request());
  expect(requireDevice).toHaveBeenCalledWith(expect.any(Headers), []);
  expect(ingestHealth).toHaveBeenCalledWith('alice', 'phone', healthFixture);
  expect(response.headers.get('cache-control')).toBe('no-store');
});
it('bounds requests and rejects malformed JSON before persistence', async () => {
  (requireDevice as jest.Mock).mockResolvedValue({
    userId: 'alice',
    credentialId: 'phone',
    scopes: ['health:write'],
  });
  expect((await POST(request('x'.repeat(65537)))).status).toBe(413);
  expect((await POST(request('{'))).status).toBe(400);
  expect(ingestHealth).not.toHaveBeenCalled();
});

it('audits failed validation, missing scope and rolled-back ingestion independently', async () => {
  (requireDevice as jest.Mock).mockResolvedValue({
    userId: 'alice',
    credentialId: 'phone',
    scopes: ['health:write'],
  });
  expect((await POST(request('{}'))).status).toBe(400);
  expect(prisma.companionEvent.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', errorCategory: 'BAD_REQUEST' }),
    })
  );
  (ingestHealth as jest.Mock).mockRejectedValue(
    new TRPCError({ code: 'CONFLICT', message: 'test' })
  );
  expect((await POST(request())).status).toBe(409);
  expect(prisma.companionEvent.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', errorCategory: 'CONFLICT' }),
    })
  );
  (requireDevice as jest.Mock).mockResolvedValue({
    userId: 'alice',
    credentialId: 'phone',
    scopes: [],
  });
  expect((await POST(request())).status).toBe(403);
  expect(prisma.companionEvent.update).toHaveBeenLastCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ errorCategory: 'FORBIDDEN' }) })
  );
});
it('never stores invalid raw bodies or arbitrary headers', async () => {
  (requireDevice as jest.Mock).mockResolvedValue({
    userId: 'alice',
    credentialId: 'phone',
    scopes: ['health:write'],
  });
  await POST(request('{"token":"vela_device_test_secret"}'));
  expect(JSON.stringify((prisma.companionEvent.update as jest.Mock).mock.calls)).not.toContain(
    'vela_device_test_secret'
  );
});
it('persists safe server failures without exposing exception messages', async () => {
  (requireDevice as jest.Mock).mockResolvedValue({
    userId: 'alice',
    credentialId: 'phone',
    scopes: ['health:write'],
  });
  (ingestHealth as jest.Mock).mockRejectedValue(new Error('secret database internals'));
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain('secret database internals');
  expect(prisma.companionEvent.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ errorCategory: 'INTERNAL_SERVER_ERROR' }),
    })
  );
});
