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
jest.mock('../generation/service', () => ({ generateDayPlan: jest.fn() }));
import { proposalRouter } from './router';
import { proposalService } from './service';
import { generateDayPlan } from '../generation/service';

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
it('authenticates generation and validates its mode, date and guidance before delegation', async () => {
  const input = {
    requestId: '00000000-0000-4000-8000-000000000001',
    date: '2030-01-07',
    mode: 'ai' as const,
    guidance: 'Keep today light',
  };
  await expect(proposalRouter.createCaller({ userId: null }).generate(input)).rejects.toMatchObject(
    { code: 'UNAUTHORIZED' }
  );
  const caller = proposalRouter.createCaller({ userId: 'owner' });
  await expect(caller.generate({ ...input, guidance: 'x'.repeat(2001) })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  expect(generateDayPlan).not.toHaveBeenCalled();
  await caller.generate(input);
  expect(generateDayPlan).toHaveBeenCalledWith('owner', input);
});
it('rejects malformed proposal IDs and dates at the boundary', async () => {
  const caller = proposalRouter.createCaller({ userId: 'owner' });
  await expect(caller.get({ id: 'not-an-id' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  await expect(caller.list({ date: '2030-02-30' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(proposalService.get).not.toHaveBeenCalled();
  expect(proposalService.list).not.toHaveBeenCalled();
});
