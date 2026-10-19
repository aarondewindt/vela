/** @jest-environment node */
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

const origin = 'https://vela.aarondewindt.space';
const previousEnv = process.env;
beforeEach(() => {
  process.env = { ...previousEnv, VELA_PUBLIC_MODE: 'true', BETTER_AUTH_URL: origin };
});
afterEach(() => {
  process.env = previousEnv;
});
function request(path: string, init?: { method?: string; headers?: Record<string, string> }) {
  return new NextRequest(`http://localhost:3001${path}`, {
    ...init,
    headers: { host: 'vela.aarondewindt.space', ...init?.headers },
  });
}
it('requires the canonical host and ignores spoofed proxy headers', () => {
  expect(
    proxy(
      request('/', {
        headers: { host: 'evil.test', 'x-forwarded-host': 'vela.aarondewindt.space' },
      })
    ).status
  ).toBe(421);
  expect(proxy(request('/')).headers.get('x-middleware-next')).toBe('1');
});
it.each([
  '/__nextjs_original-stack-frames',
  '/_next/webpack-hmr',
  '/_next/static/example.js.map',
  '/dev-tools',
])('blocks public debugging path %s', (path) => {
  expect(proxy(request(path)).status).toBe(404);
});
it('blocks cross-origin mutations and preserves same-origin tunnel requests', () => {
  expect(
    proxy(
      request('/api/trpc/nutrition.create', {
        method: 'POST',
        headers: { origin: 'https://evil.test' },
      })
    ).status
  ).toBe(403);
  expect(
    proxy(
      request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { origin, 'sec-fetch-site': 'cross-site' },
      })
    ).status
  ).toBe(403);
  expect(
    proxy(
      request('/api/trpc/nutrition.create', { method: 'POST', headers: { origin } })
    ).headers.get('x-middleware-next')
  ).toBe('1');
});
it('marks private pages and APIs uncacheable while leaving hashed assets to Next', () => {
  expect(proxy(request('/nutrition')).headers.get('cache-control')).toBe('private, no-store');
  expect(proxy(request('/api/auth/get-session')).headers.get('cache-control')).toBe(
    'private, no-store'
  );
  expect(proxy(request('/_next/static/chunk.js')).headers.has('cache-control')).toBe(false);
});
it('leaves the local development server accessible', () => {
  delete process.env.VELA_PUBLIC_MODE;
  expect(
    proxy(request('/dev-tools', { headers: { host: 'localhost:3000' } })).headers.get(
      'x-middleware-next'
    )
  ).toBe('1');
});
