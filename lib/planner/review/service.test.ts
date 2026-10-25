/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({ prisma: { $transaction: jest.fn() } }));
jest.mock('@/lib/ai/structured', () => ({ generateStructured: jest.fn() }));
jest.mock('@/lib/model-settings/service', () => ({ requireModelSelection: jest.fn() }));
jest.mock('../proposals/snapshot', () => ({ loadSnapshot: jest.fn() }));
import { prisma } from '@/lib/prisma';
import { generateStructured } from '@/lib/ai/structured';
import { requireModelSelection } from '@/lib/model-settings/service';
import { AiError } from '@/lib/ai/errors';
import { loadSnapshot } from '../proposals/snapshot';
import { progressFixture } from '../proposals/replan-fixtures';
import { taskId } from '../generation/fixtures';
import { reviewDayPlan } from './service';

const findFirst = jest.fn();
beforeEach(() => {
  jest.resetAllMocks();
  (prisma.$transaction as jest.Mock).mockImplementation((fn) =>
    fn({ planningProposal: { findFirst } })
  );
  (loadSnapshot as jest.Mock).mockResolvedValue(progressFixture());
  (requireModelSelection as jest.Mock).mockResolvedValue({
    provider: 'ollama',
    modelId: 'fixture',
  });
});
it('loads an owner-scoped snapshot without calling AI or writing anything', async () => {
  const result = await reviewDayPlan('owner', { date: '2030-01-07' });
  expect(loadSnapshot).toHaveBeenCalledWith(expect.anything(), 'owner', '2030-01-07');
  expect(result.concerns).toEqual([]);
  expect(generateStructured).not.toHaveBeenCalled();
  expect(findFirst).not.toHaveBeenCalled();
});
it('keeps AI concerns separate with resolved task/block references and user guidance', async () => {
  (generateStructured as jest.Mock).mockResolvedValue({
    concerns: [
      { blockKeys: ['B2'], explanation: 'This work may not match the requested lighter day.' },
    ],
  });
  const result = await reviewDayPlan('owner', {
    date: '2030-01-07',
    mode: 'ai',
    guidance: 'Keep it light',
  });
  expect(requireModelSelection).toHaveBeenCalledWith('owner', 'planner.planReview', undefined);
  expect(result.concerns[0]).toMatchObject({
    code: 'AI_CONTEXT',
    blockIds: [taskId(21)],
    taskIds: [taskId(2)],
  });
  expect(result.conflicts.every((c) => c.code !== 'AI_CONTEXT')).toBe(true);
  expect(JSON.parse((generateStructured as jest.Mock).mock.calls[0][0].prompt).guidance).toBe(
    'Keep it light'
  );
});
it.each([new AiError('INVALID_PROVIDER_RESPONSE', 'Unavailable'), null])(
  'retains verified results on provider errors and rejects invented references (%s)',
  async (error) => {
    if (error) {
      (generateStructured as jest.Mock).mockRejectedValue(error);
    } else {
      (generateStructured as jest.Mock).mockResolvedValue({
        concerns: [{ blockKeys: ['B999'], explanation: 'Invented' }],
      });
    }
    const result = await reviewDayPlan('owner', { date: '2030-01-07', mode: 'ai' });
    expect(result.aiError).toBeTruthy();
    expect(result.concerns).toEqual([]);
    expect(result.blocks).toHaveLength(3);
  }
);
it('rejects missing/foreign, stale, resolved and wrong-date proposals', async () => {
  const input = { date: '2030-01-07', proposalId: taskId(99) };
  findFirst.mockResolvedValue(null);
  await expect(reviewDayPlan('owner', input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(findFirst).toHaveBeenCalledWith({
    where: { id: input.proposalId, userId: 'owner', planDate: new Date('2030-01-07T00:00:00Z') },
  });
  findFirst.mockResolvedValue({ status: 'PENDING', baseHash: 'old' });
  await expect(reviewDayPlan('owner', input)).rejects.toMatchObject({ code: 'CONFLICT' });
  findFirst.mockResolvedValue({ status: 'APPLIED', baseHash: 'a'.repeat(64) });
  await expect(reviewDayPlan('owner', input)).rejects.toMatchObject({ code: 'CONFLICT' });
});

it('reviews the projected pending plan without persisting or applying it', async () => {
  findFirst.mockResolvedValue({
    status: 'PENDING',
    baseHash: 'a'.repeat(64),
    document: {
      schemaVersion: 1,
      operations: [
        {
          type: 'move',
          blockId: taskId(21),
          startsAt: '2030-01-07T14:00:00Z',
          endsAt: '2030-01-07T14:30:00Z',
          explanation: 'Later work',
        },
      ],
    },
  });
  const result = await reviewDayPlan('owner', { date: '2030-01-07', proposalId: taskId(99) });
  expect(result.proposalId).toBe(taskId(99));
  expect(result.blocks.find((b) => b.id === taskId(21))?.startsAt).toBe('2030-01-07T14:00:00.000Z');
  expect(
    result.corrections.some(
      (c) =>
        c.document.operations.filter((op) => op.type !== 'add' && op.blockId === taskId(21))
          .length > 1
    )
  ).toBe(false);
});

it('uses the operation model override with empty review guidance', async () => {
  const selection = { provider: 'ollama' as const, modelId: 'review:latest' };
  jest.mocked(requireModelSelection).mockResolvedValue(selection);
  jest.mocked(generateStructured).mockResolvedValue({ concerns: [] });
  const result = await reviewDayPlan('owner', { date: '2030-01-07', mode: 'ai', selection });
  expect(requireModelSelection).toHaveBeenCalledWith('owner', 'planner.planReview', selection);
  expect(generateStructured).toHaveBeenCalledWith(expect.objectContaining({ selection }));
  expect(result.model).toEqual(selection);
});

it('ignores model overrides for verified-only review', async () => {
  await reviewDayPlan('owner', {
    date: '2030-01-07',
    selection: { provider: 'ollama', modelId: 'unused' },
  });
  expect(requireModelSelection).not.toHaveBeenCalled();
  expect(generateStructured).not.toHaveBeenCalled();
});
