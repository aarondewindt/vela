/** @jest-environment node */
jest.mock('server-only', () => ({}));
import { TRPCError } from '@trpc/server';
import { boundedJson, deviceResponse } from './http';
beforeEach(() => {
  process.env.BETTER_AUTH_URL = 'https://vela.example';
});
it('bounds streamed bodies regardless of declared length', async () => {
  const request = new Request('https://vela.example', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'x'.repeat(2049),
  });
  await expect(boundedJson(request)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
});
it('rejects malformed JSON and wrong content types', async () => {
  for (const headers of [new Headers(), new Headers({ 'content-type': 'application/json' })]) {
    await expect(
      boundedJson(new Request('https://vela.example', { method: 'POST', headers, body: '{' }))
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  }
});
it('redacts unexpected failures and disables caching of all responses', async () => {
  const response = await deviceResponse(async () => {
    throw new Error('sensitive token/database details');
  });
  expect(response.status).toBe(500);
  expect(await response.text()).toBe('{"error":"Device request failed."}');
  expect(response.headers.get('cache-control')).toBe('no-store');
});
it('uses safe 401 and 429 responses', async () => {
  for (const [code, status] of [
    ['UNAUTHORIZED', 401],
    ['TOO_MANY_REQUESTS', 429],
  ] as const) {
    const response = await deviceResponse(async () => {
      throw new TRPCError({ code, message: 'secret' });
    });
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain('secret');
    expect(response.headers.get('retry-after')).toBe(status === 429 ? '60' : null);
  }
});
it('disables device transport on HTTP deployments', async () => {
  process.env.BETTER_AUTH_URL = 'http://localhost:3000';
  const operation = jest.fn();
  expect((await deviceResponse(operation)).status).toBe(403);
  expect(operation).not.toHaveBeenCalled();
});
