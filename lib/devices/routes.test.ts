/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('./service', () => ({
  startPairing: jest.fn(),
  redeemPairing: jest.fn(),
  requireDevice: jest.fn(),
}));
import { POST as start } from '@/app/api/devices/pairing/start/route';
import { POST as redeem } from '@/app/api/devices/pairing/redeem/route';
import { GET as verify } from '@/app/api/devices/verify/route';
import { startPairing, redeemPairing, requireDevice } from './service';
const request = (body: unknown) =>
  new Request('https://vela.example', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  jest.clearAllMocks();
  process.env.BETTER_AUTH_URL = 'https://vela.example';
});
it('validates the client metadata and returns a one-time response without caching', async () => {
  (startPairing as jest.Mock).mockResolvedValue({ code: 'ABCDEF123456', sessionSecret: 'secret' });
  const response = await start(request({ name: 'Phone', clientType: 'android' }));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(startPairing).toHaveBeenCalledWith({ name: 'Phone', clientType: 'android' });
});
it.each([{ userId: 'bob' }, { scopes: ['admin'] }])(
  'rejects caller-controlled ownership and permissions',
  async (extra) => {
    expect((await start(request({ name: 'Phone', clientType: 'android', ...extra }))).status).toBe(
      400
    );
    expect(startPairing).not.toHaveBeenCalled();
  }
);
it('does not accept a display code as a redemption secret', async () => {
  expect((await redeem(request({ sessionSecret: 'ABCDEF123456' }))).status).toBe(400);
  expect(redeemPairing).not.toHaveBeenCalled();
});
it('requires a scoped device credential even if a browser cookie is supplied', async () => {
  (requireDevice as jest.Mock).mockResolvedValue({
    userId: 'alice',
    credentialId: 'device',
    scopes: ['health:write'],
  });
  const headers = new Headers({ cookie: 'browser-session=ignored' });
  expect((await verify(new Request('https://vela.example', { headers }))).status).toBe(200);
  expect(requireDevice).toHaveBeenCalledWith(headers, ['health:write']);
});
