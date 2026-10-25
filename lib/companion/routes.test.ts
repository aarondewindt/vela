/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/devices/service', () => ({ requireDevice: jest.fn() }));
jest.mock('./service', () => ({ saveDiagnostics: jest.fn() }));
import { TRPCError } from '@trpc/server';
import { requireDevice } from '@/lib/devices/service';
import { saveDiagnostics } from './service';
import { POST } from '@/app/api/devices/diagnostics/route';
import { snapshotFixture } from './fixtures';
const request = (body = JSON.stringify(snapshotFixture)) =>
  new Request('https://vela.test/api/devices/diagnostics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
beforeEach(() => {
  jest.clearAllMocks();
  process.env.BETTER_AUTH_URL = 'https://vela.test';
});
it('requires the existing device credential and forwards only authenticated identity', async () => {
  (requireDevice as jest.Mock).mockResolvedValue({ userId: 'alice', credentialId: 'phone' });
  (saveDiagnostics as jest.Mock).mockResolvedValue({ version: 1, id: 'snapshot' });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(requireDevice).toHaveBeenCalledWith(expect.any(Headers), ['health:write']);
  expect(saveDiagnostics).toHaveBeenCalledWith('alice', 'phone', snapshotFixture);
});
it('preserves scheduler observations and cancellation reasons through the HTTP boundary', async () => {
  (requireDevice as jest.Mock).mockResolvedValue({ userId: 'alice', credentialId: 'phone' });
  (saveDiagnostics as jest.Mock).mockResolvedValue({ version: 1, id: 'snapshot' });
  const snapshot = {
    ...snapshotFixture,
    diagnostic: {
      ...snapshotFixture.diagnostic,
      background: {
        intervalMinutes: 15,
        workAvailable: false,
        powerSaveMode: false,
        batteryOptimizationIgnored: false,
        backgroundRestricted: false,
        interactive: false,
        networkValidated: true,
        work: [],
      },
    },
    attempts: [{ ...snapshotFixture.attempts[0], status: 'cancelled', workStopReason: 7 }],
  };
  expect((await POST(request(JSON.stringify(snapshot)))).status).toBe(200);
  expect(saveDiagnostics).toHaveBeenCalledWith('alice', 'phone', snapshot);
});
it.each(['UNAUTHORIZED', 'FORBIDDEN'] as const)(
  'rejects %s before reading or saving diagnostics',
  async (code) => {
    (requireDevice as jest.Mock).mockRejectedValue(new TRPCError({ code }));
    expect((await POST(request())).status).toBe(code === 'UNAUTHORIZED' ? 401 : 403);
    expect(saveDiagnostics).not.toHaveBeenCalled();
  }
);
it('enforces streaming byte limits and JSON syntax', async () => {
  (requireDevice as jest.Mock).mockResolvedValue({ userId: 'alice', credentialId: 'phone' });
  expect((await POST(request('x'.repeat(262145)))).status).toBe(413);
  expect((await POST(request('{'))).status).toBe(400);
  expect(saveDiagnostics).not.toHaveBeenCalled();
});
