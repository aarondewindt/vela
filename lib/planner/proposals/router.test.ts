jest.mock('superjson', () => ({
  serialize: (value: unknown) => value,
  deserialize: (value: unknown) => value,
}));
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('./service', () => ({
  proposalService: {
    replan: jest.fn(),
    context: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    createEdit: jest.fn(),
    accept: jest.fn(),
    discard: jest.fn(),
  },
}));
jest.mock('../review/service', () => ({ reviewDayPlan: jest.fn() }));
jest.mock('../generation/service', () => ({ generateDayPlan: jest.fn() }));
import { proposalRouter } from './router';
import { proposalService } from './service';
import { generateDayPlan } from '../generation/service';
import { reviewDayPlan } from '../review/service';

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

it('authenticates and validates structured replanning before delegation', async () => {
  const input = {
    requestId: '00000000-0000-4000-8000-000000000001',
    date: '2030-01-07',
    baseHash: 'a'.repeat(64),
    action: 'finish' as const,
    blockId: '00000000-0000-4000-8000-000000000002',
    endTime: '09:20',
    explanation: 'Finished this segment',
  };
  await expect(proposalRouter.createCaller({ userId: null }).replan(input)).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  const caller = proposalRouter.createCaller({ userId: 'owner' });
  await expect(caller.replan({ ...input, estimatedMinutes: -10 })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  expect(proposalService.replan).not.toHaveBeenCalled();
  await caller.replan(input);
  expect(proposalService.replan).toHaveBeenCalledWith('owner', {
    ...input,
    completeTask: false,
    pullForward: false,
  });
});

it('authenticates plan review and validates its boundary inputs', async () => {
  await expect(
    proposalRouter.createCaller({ userId: null }).review({ date: '2030-01-07' })
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  const caller = proposalRouter.createCaller({ userId: 'owner' });
  await expect(caller.review({ date: '2030-02-30' })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  await expect(caller.review({ date: '2030-01-07', proposalId: 'foreign' })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  await expect(
    caller.review({ date: '2030-01-07', guidance: 'x'.repeat(2001) })
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

it('delegates a valid plan review with authenticated ownership and safe defaults', async () => {
  await proposalRouter.createCaller({ userId: 'owner' }).review({ date: '2030-01-07' });
  expect(reviewDayPlan).toHaveBeenCalledWith('owner', {
    date: '2030-01-07',
    mode: 'deterministic',
    guidance: '',
  });
});
