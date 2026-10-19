jest.mock('superjson', () => ({
  serialize: (value: unknown) => value,
  deserialize: (value: unknown) => value,
}));
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('./service', () => ({
  proposalService: {
    context: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    createEdit: jest.fn(),
    accept: jest.fn(),
    discard: jest.fn(),
  },
}));
import { proposalRouter } from './router';
import { proposalService } from './service';

it('rejects anonymous proposal reads and acceptance', async () => {
  const caller = proposalRouter.createCaller({ userId: null });
  await expect(caller.context({ date: '2030-01-07' })).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  await expect(caller.accept({ id: '00000000-0000-4000-8000-000000000001' })).rejects.toMatchObject(
    { code: 'UNAUTHORIZED' }
  );
  expect(proposalService.context).not.toHaveBeenCalled();
  expect(proposalService.accept).not.toHaveBeenCalled();
});
it('rejects malformed proposal IDs and dates at the boundary', async () => {
  const caller = proposalRouter.createCaller({ userId: 'owner' });
  await expect(caller.get({ id: 'not-an-id' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  await expect(caller.list({ date: '2030-02-30' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(proposalService.get).not.toHaveBeenCalled();
  expect(proposalService.list).not.toHaveBeenCalled();
});
