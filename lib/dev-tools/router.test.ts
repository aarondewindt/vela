/** @jest-environment node */
jest.mock('superjson', () => ({ serialize: (v: unknown) => v, deserialize: (v: unknown) => v }));
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('./service', () => ({ devToolsService: { listTestTasks: jest.fn() } }));
import { devToolsRouter } from './router';
import { devToolsService } from './service';

const previousMode = process.env.VELA_PUBLIC_MODE;
afterEach(() => {
  if (previousMode === undefined) {
    delete process.env.VELA_PUBLIC_MODE;
  } else {
    process.env.VELA_PUBLIC_MODE = previousMode;
  }
  jest.clearAllMocks();
});
it('rejects anonymous requests before accessing development data', async () => {
  await expect(devToolsRouter.createCaller({ userId: null }).listTestTasks()).rejects.toMatchObject(
    { code: 'UNAUTHORIZED' }
  );
  expect(devToolsService.listTestTasks).not.toHaveBeenCalled();
});
it('disables development procedures on the public server even for signed-in users', async () => {
  process.env.VELA_PUBLIC_MODE = 'true';
  await expect(
    devToolsRouter.createCaller({ userId: 'owner' }).listTestTasks()
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(devToolsService.listTestTasks).not.toHaveBeenCalled();
});
it('retains owner-scoped development tools on the local server', async () => {
  delete process.env.VELA_PUBLIC_MODE;
  await devToolsRouter.createCaller({ userId: 'owner' }).listTestTasks();
  expect(devToolsService.listTestTasks).toHaveBeenCalledWith('owner');
});
