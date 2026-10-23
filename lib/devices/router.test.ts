/** @jest-environment node */
jest.mock('superjson', () => ({
  serialize: (value: unknown) => value,
  deserialize: (value: unknown) => value,
}));
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('./service', () => ({
  listDevices: jest.fn(),
  reviewPairing: jest.fn(),
  approvePairing: jest.fn(),
  revokeDevice: jest.fn(),
}));
import { devicesRouter } from './router';
import { approvePairing, listDevices, revokeDevice } from './service';
it('requires a browser session for all management operations', async () => {
  const caller = devicesRouter.createCaller({ userId: null });
  await expect(caller.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  await expect(caller.review({ code: 'ABCDEF123456' })).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  await expect(caller.approve({ code: 'ABCDEF123456' })).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  await expect(caller.revoke({ id: 'a5262ff1-9b0c-47f3-b3ef-d5993e3605a1' })).rejects.toMatchObject(
    { code: 'UNAUTHORIZED' }
  );
});
it('takes owner from the session, normalizes codes and validates inputs', async () => {
  const caller = devicesRouter.createCaller({ userId: 'alice' });
  await caller.list();
  expect(listDevices).toHaveBeenCalledWith('alice');
  await caller.approve({ code: ' abcdef123456 ' });
  expect(approvePairing).toHaveBeenCalledWith('alice', 'ABCDEF123456');
  await caller.revoke({ id: 'a5262ff1-9b0c-47f3-b3ef-d5993e3605a1' });
  expect(revokeDevice).toHaveBeenCalledWith('alice', 'a5262ff1-9b0c-47f3-b3ef-d5993e3605a1');
  await expect(caller.approve({ code: 'bad' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});
