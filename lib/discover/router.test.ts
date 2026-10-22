/** @jest-environment node */
/* eslint-disable no-script-url -- Tests verify rejection of unsafe URLs. */
jest.mock('server-only', () => ({}));
jest.mock('superjson', () => ({ serialize: (v: unknown) => v, deserialize: (v: unknown) => v }));
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('./service', () => ({
  discoverService: {
    list: jest.fn(),
    types: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    setStatus: jest.fn(),
    remove: jest.fn(),
  },
}));
import { discoverRouter } from './router';
import { discoverService } from './service';
const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => jest.clearAllMocks());

it('requires authentication on every Discover procedure', async () => {
  const caller = discoverRouter.createCaller({ userId: null });
  for (const call of [
    () => caller.list({}),
    () => caller.types(),
    () => caller.get({ id }),
    () => caller.create({ title: 'Dune' }),
    () => caller.quickAdd({ text: 'Dune' }),
    () => caller.update({ id, version: 1, item: { title: 'Dune' } }),
    () => caller.setStatus({ id, version: 1, status: 'COMPLETED' }),
    () => caller.remove({ id, version: 1 }),
  ]) {
    await expect(call()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  }
  for (const fn of Object.values(discoverService)) {
    expect(fn).not.toHaveBeenCalled();
  }
});
it('takes ownership only from the session and transforms quick URLs before the service', async () => {
  const caller = discoverRouter.createCaller({ userId: 'alice' });
  await caller.create({ title: 'Dune', userId: 'bob' } as never);
  expect(discoverService.create).toHaveBeenCalledWith(
    'alice',
    expect.objectContaining({ title: 'Dune' })
  );
  expect((discoverService.create as jest.Mock).mock.calls[0][1]).not.toHaveProperty('userId');
  await caller.quickAdd({ text: 'https://example.com', contentType: 'Website' });
  expect(discoverService.create).toHaveBeenLastCalledWith(
    'alice',
    expect.objectContaining({
      title: 'https://example.com',
      url: 'https://example.com',
      contentType: 'Website',
    })
  );
  await caller.get({ id });
  await caller.list({});
  await caller.types();
  await caller.update({ id, version: 1, item: { title: 'Updated' } });
  await caller.setStatus({ id, version: 2, status: 'DROPPED' });
  await caller.remove({ id, version: 3 });
  expect(discoverService.get).toHaveBeenCalledWith('alice', id);
  expect(discoverService.list).toHaveBeenCalledWith(
    'alice',
    expect.objectContaining({ sort: 'newest' })
  );
  expect(discoverService.types).toHaveBeenCalledWith('alice');
  expect(discoverService.update).toHaveBeenCalledWith(
    'alice',
    id,
    1,
    expect.objectContaining({ title: 'Updated' })
  );
  expect(discoverService.setStatus).toHaveBeenCalledWith('alice', id, 2, 'DROPPED');
  expect(discoverService.remove).toHaveBeenCalledWith('alice', id, 3);
});
it('rejects invalid identifiers, versions, URLs and ratings before any service work', async () => {
  const caller = discoverRouter.createCaller({ userId: 'alice' });
  for (const call of [
    () => caller.get({ id: 'bad' }),
    () => caller.create({ title: ' ' }),
    () => caller.create({ title: 'Item', url: 'javascript:alert(1)' }),
    () => caller.update({ id, version: 0, item: { title: 'Item' } }),
    () => caller.create({ title: 'Item', rating: 11 }),
    () => caller.setStatus({ id, version: 1, status: 'OTHER' } as never),
  ]) {
    await expect(call()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  }
  for (const fn of Object.values(discoverService)) {
    expect(fn).not.toHaveBeenCalled();
  }
});
