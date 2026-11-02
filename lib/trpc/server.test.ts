/** @jest-environment node */
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('superjson', () => ({
  serialize: (value: unknown) => value,
  deserialize: (value: unknown) => value,
}));

import { auth } from '@/lib/auth';
import { createTRPCContext } from './server';

it('passes request cancellation to authenticated service callers', async () => {
  jest.mocked(auth.api.getSession).mockResolvedValueOnce({
    user: { id: 'owner' },
  } as Awaited<ReturnType<typeof auth.api.getSession>>);
  const controller = new AbortController();
  const req = new Request('http://localhost/api/trpc', { signal: controller.signal });
  const context = await createTRPCContext({ req });
  expect(context.userId).toBe('owner');
  expect(context.signal?.aborted).toBe(false);
  controller.abort();
  expect(context.signal?.aborted).toBe(true);
});

it('keeps unauthenticated requests unauthenticated', async () => {
  jest.mocked(auth.api.getSession).mockResolvedValueOnce(null);
  const context = await createTRPCContext({ req: new Request('http://localhost/api/trpc') });
  expect(context.userId).toBeNull();
});
