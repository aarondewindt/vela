/** @jest-environment node */
jest.mock('superjson', () => ({ serialize: (v: unknown) => v, deserialize: (v: unknown) => v }));
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('./service', () => ({
  listEvents: jest.fn(),
  eventDetail: jest.fn(),
  deviceOverview: jest.fn(),
  listUploads: jest.fn(),
  uploadDetail: jest.fn(),
}));
import { companionRouter } from './router';
import { listEvents, eventDetail, uploadDetail } from './service';
afterEach(() => {
  delete process.env.VELA_PUBLIC_MODE;
  jest.clearAllMocks();
});
it('denies anonymous and public-server access', async () => {
  await expect(companionRouter.createCaller({ userId: null }).events({})).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  process.env.VELA_PUBLIC_MODE = 'true';
  await expect(companionRouter.createCaller({ userId: 'alice' }).events({})).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  expect(listEvents).not.toHaveBeenCalled();
});
it('passes authenticated owner to list and detail services, never input owner', async () => {
  const caller = companionRouter.createCaller({ userId: 'alice' });
  const id = '10000000-0000-4000-8000-000000000001';
  await caller.events({ trigger: 'automatic' });
  await caller.event({ id });
  await caller.upload({ id });
  expect(listEvents).toHaveBeenCalledWith(
    'alice',
    expect.objectContaining({ trigger: 'automatic', limit: 25 })
  );
  expect(eventDetail).toHaveBeenCalledWith('alice', id);
  expect(uploadDetail).toHaveBeenCalledWith('alice', id);
});
