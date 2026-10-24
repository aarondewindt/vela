/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));
jest.mock('../conversation/transaction', () => ({ locked: jest.fn() }));
jest.mock('../conversation/records', () => ({
  recordContext: jest.fn(),
  previewRecord: jest.fn(),
  applyRecord: jest.fn(),
}));
import { locked } from '../conversation/transaction';
import { recordContext, previewRecord, applyRecord } from '../conversation/records';
import { workspaceRecords } from './records';
const id = '00000000-0000-4000-8000-000000000001';
const preview = {
  entity: 'task',
  action: 'create',
  id: null,
  baseHash: 'hash',
  before: null,
  patch: { title: 'Report' },
  warnings: [],
};
const instruction = {
  type: 'record',
  entity: 'task',
  action: 'create',
  query: null,
  task: { title: 'Report' },
  theme: null,
} as const;
const row = { id, conversationId: id, status: 'PENDING', preview, receipt: null };
const tx = {
  $executeRaw: jest.fn(),
  aiConversation: { findFirst: jest.fn() },
  aiMessage: { findFirst: jest.fn() },
  plannerRecordProposal: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(locked).mockImplementation(async (fn) => fn(tx as any));
  tx.aiConversation.findFirst.mockResolvedValue({ id });
  tx.aiMessage.findFirst.mockResolvedValue({ id: 'message' });
  tx.plannerRecordProposal.create.mockImplementation(async ({ data }) => ({ ...row, ...data }));
  tx.plannerRecordProposal.update.mockImplementation(async ({ data }) => ({ ...row, ...data }));
  jest.mocked(recordContext).mockResolvedValue({ hash: 'hash' } as any);
  jest.mocked(previewRecord).mockReturnValue(preview as any);
  jest.mocked(applyRecord).mockResolvedValue({ id });
});
it('checks owner and Planner scope before reading records or persisting a preview', async () => {
  tx.aiConversation.findFirst.mockResolvedValue(null);
  await expect(
    workspaceRecords.propose('other', id, id, instruction, 'message')
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(tx.aiConversation.findFirst).toHaveBeenCalledWith({
    where: { id, userId: 'other', scope: 'planner' },
  });
  expect(recordContext).not.toHaveBeenCalled();
  expect(tx.plannerRecordProposal.create).not.toHaveBeenCalled();
});
it('durably saves previews and replays the same request before reading context or creating again', async () => {
  await workspaceRecords.propose('owner', id, id, instruction, 'message');
  const data = tx.plannerRecordProposal.create.mock.calls[0][0].data;
  tx.plannerRecordProposal.findUnique.mockResolvedValue({ ...row, ...data });
  jest.mocked(recordContext).mockClear();
  expect(await workspaceRecords.propose('owner', id, id, instruction, 'message')).toMatchObject({
    id,
    status: 'PENDING',
  });
  expect(recordContext).not.toHaveBeenCalled();
  expect(tx.plannerRecordProposal.create).toHaveBeenCalledTimes(1);
  await expect(
    workspaceRecords.propose(
      'owner',
      id,
      id,
      { ...instruction, task: { title: 'Different' } },
      'message'
    )
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('retains prior fields on corrections and supersedes only after valid preview construction', async () => {
  tx.plannerRecordProposal.findFirst.mockResolvedValue(row);
  await workspaceRecords.propose('owner', id, id, instruction, 'message');
  expect(previewRecord).toHaveBeenCalledWith({ hash: 'hash' }, instruction, preview);
  jest.mocked(previewRecord).mockImplementation(() => {
    throw new Error('Ambiguous');
  });
  tx.plannerRecordProposal.updateMany.mockClear();
  await expect(workspaceRecords.propose('owner', id, id, instruction, 'message')).rejects.toThrow(
    'Ambiguous'
  );
  expect(tx.plannerRecordProposal.updateMany).not.toHaveBeenCalled();
});
it('fences late tools from earlier messages', async () => {
  tx.aiMessage.findFirst.mockResolvedValue({ id: 'new-message' });
  await expect(
    workspaceRecords.propose('owner', id, id, instruction, 'message')
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(tx.plannerRecordProposal.create).not.toHaveBeenCalled();
});
it('delegates explicit acceptance to the existing transactional record service and saves a receipt', async () => {
  tx.plannerRecordProposal.findFirst.mockResolvedValue(row);
  await workspaceRecords.resolve('owner', id, id, 'accept', true);
  expect(applyRecord).toHaveBeenCalledWith(tx, 'owner', preview, true);
  expect(tx.plannerRecordProposal.update).toHaveBeenCalledWith({
    where: { id },
    data: { status: 'ACCEPTED', receipt: { id } },
  });
});
it('replays accepted receipts even after later record deletion without creating anything', async () => {
  tx.plannerRecordProposal.findFirst.mockResolvedValue({
    ...row,
    status: 'ACCEPTED',
    receipt: { id },
  });
  expect(await workspaceRecords.resolve('owner', id, id, 'accept')).toMatchObject({
    accepted: true,
  });
  expect(applyRecord).not.toHaveBeenCalled();
});
it('blocks acceptance during streaming and after superseding or discarding', async () => {
  tx.plannerRecordProposal.findFirst.mockResolvedValue(row);
  tx.aiConversation.findFirst.mockResolvedValue({
    id,
    activeGenerationId: id,
    generationStartedAt: new Date(),
  });
  await expect(workspaceRecords.resolve('owner', id, id, 'accept')).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  tx.aiConversation.findFirst.mockResolvedValue({ id });
  tx.plannerRecordProposal.findFirst.mockResolvedValue({ ...row, status: 'SUPERSEDED' });
  await expect(workspaceRecords.resolve('owner', id, id, 'accept')).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  expect(applyRecord).not.toHaveBeenCalled();
});
it('keeps the preview pending on stale/deletion/validation errors and discards without a domain write', async () => {
  tx.plannerRecordProposal.findFirst.mockResolvedValue(row);
  jest.mocked(applyRecord).mockRejectedValue(new Error('Stale or unconfirmed'));
  await expect(workspaceRecords.resolve('owner', id, id, 'accept')).rejects.toThrow(
    'Stale or unconfirmed'
  );
  expect(tx.plannerRecordProposal.update).not.toHaveBeenCalled();
  jest.mocked(applyRecord).mockClear();
  await workspaceRecords.resolve('owner', id, id, 'discard');
  expect(applyRecord).not.toHaveBeenCalled();
  expect(tx.plannerRecordProposal.update).toHaveBeenCalledWith({
    where: { id },
    data: { status: 'DISCARDED' },
  });
});
