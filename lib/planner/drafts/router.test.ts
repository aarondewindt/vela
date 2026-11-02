/** @jest-environment node */
jest.mock('superjson', () => ({
  serialize: (value: unknown) => value,
  deserialize: (value: unknown) => value,
}));
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('server-only', () => ({}));
jest.mock('./service', () => ({
  draftService: {
    read: jest.fn(),
    apply: jest.fn(),
    accept: jest.fn(),
    history: jest.fn(),
    snapshot: jest.fn(),
  },
}));
jest.mock('./generation', () => ({
  ...jest.requireActual('./generation'),
  generateWorkingDraft: jest.fn(),
}));
jest.mock('./manual', () => ({ ...jest.requireActual('./manual'), editWorkingDraft: jest.fn() }));
jest.mock('../generation/service', () => ({ generateDayPlan: jest.fn() }));
jest.mock('../review/service', () => ({ reviewDayPlan: jest.fn() }));
import { draftRouter } from './router';
import { draftService } from './service';
import { editWorkingDraft } from './manual';
const date = '2030-01-07';
const input = {
  date,
  requestId: '00000000-0000-4000-8000-000000000001',
  draftId: null,
  expectedVersion: 0,
};
const caller = (userId: string | null) => draftRouter.createCaller({ userId } as any);
beforeEach(() => jest.clearAllMocks());
it('constructs a router with valid procedure names and authenticates before reads/writes', async () => {
  await expect(caller(null).read({ date })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  await expect(caller(null).accept(input)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  expect(draftService.read).not.toHaveBeenCalled();
  expect(draftService.accept).not.toHaveBeenCalled();
});
it('binds manual edits to the authenticated owner and validates expected versions', async () => {
  const edit = { ...input, action: 'remove' as const, blockId: input.requestId };
  await caller('owner').edit(edit);
  expect(editWorkingDraft).toHaveBeenCalledWith('owner', edit);
  await expect(caller('owner').edit({ ...edit, expectedVersion: -1 })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
});
it('rejects caller-owned user IDs at the API boundary', async () => {
  await expect(caller('owner').accept({ ...input, userId: 'other' } as any)).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  expect(draftService.accept).not.toHaveBeenCalled();
});
