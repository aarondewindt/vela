/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({ prisma: { planningProposal: { findFirst: jest.fn() } } }));
jest.mock('../proposals/service', () => ({
  proposalService: {
    context: jest.fn(),
    replan: jest.fn(),
    createEdit: jest.fn(),
    create: jest.fn(),
  },
}));
jest.mock('../generation/service', () => ({ generateDayPlan: jest.fn() }));
jest.mock('../review/service', () => ({ reviewDayPlan: jest.fn() }));
import { prisma } from '@/lib/prisma';
import { proposalService } from '../proposals/service';
import { generateDayPlan } from '../generation/service';
import { planInstruction } from './planning';
import type { Instruction } from './schema';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const date = '2026-10-20';
const block = {
  id: id(1),
  title: 'Write report',
  taskId: id(7),
  startsAt: '2026-10-20T08:00:00.000Z',
  endsAt: '2026-10-20T09:00:00.000Z',
  status: 'PLANNED',
  editable: true,
  adjustable: true,
  durationMinutes: 60,
};
const replan = (values = {}): Extract<Instruction, { type: 'replan' }> => ({
  type: 'replan',
  date,
  action: 'extend',
  blockQuery: 'Write report',
  candidateQuery: null,
  startTime: null,
  endTime: null,
  additionalMinutes: 30,
  completeTask: false,
  explanation: 'Needs more time',
  ...values,
});
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(proposalService.context).mockResolvedValue({
    timezone: 'Europe/Amsterdam',
    baseHash: 'a'.repeat(64),
    blocks: [block],
    candidates: [],
  });
  jest.mocked(proposalService.replan).mockResolvedValue({ id: id(2) });
  jest.mocked(proposalService.create).mockResolvedValue({ id: id(2) });
});
it('calculates extension from recorded block end in the saved timezone and delegates validated replanning', async () => {
  const result = await planInstruction('owner', id(9), replan());
  expect(result.proposalId).toBe(id(2));
  expect(proposalService.replan).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({ endTime: '11:30', blockId: id(1), completeTask: false })
  );
});
it('asks for clarification on ambiguous blocks and arbitrary easier replacements', async () => {
  jest.mocked(proposalService.context).mockResolvedValue({
    timezone: 'Europe/Amsterdam',
    baseHash: 'a'.repeat(64),
    blocks: [block, { ...block, id: id(3) }],
    candidates: [],
  });
  await expect(planInstruction('owner', id(9), replan())).rejects.toThrow('Several blocks');
  await expect(
    planInstruction(
      'owner',
      id(9),
      replan({
        action: 'replace',
        blockQuery: id(1),
        candidateQuery: null,
        additionalMinutes: null,
      })
    )
  ).rejects.toThrow('Which eligible task');
  expect(proposalService.replan).not.toHaveBeenCalled();
});
it('reserves a specified local interval and releases overlapping flexible allocations through proposals', async () => {
  await planInstruction('owner', id(9), {
    type: 'reserve',
    date,
    startTime: '10:00',
    endTime: '12:00',
    explanation: 'Keep free',
  });
  expect(proposalService.create).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({
      document: expect.objectContaining({
        operations: [{ type: 'remove', blockId: id(1), explanation: 'Keep free' }],
        freeIntervals: [
          expect.objectContaining({
            startsAt: '2026-10-20T08:00:00.000Z',
            endsAt: '2026-10-20T10:00:00.000Z',
          }),
        ],
      }),
    })
  );
});
it('does not remove protected commitments to reserve free time', async () => {
  jest.mocked(proposalService.context).mockResolvedValue({
    timezone: 'Europe/Amsterdam',
    baseHash: 'a'.repeat(64),
    blocks: [{ ...block, editable: false }],
    candidates: [],
  });
  await expect(
    planInstruction('owner', id(9), {
      type: 'reserve',
      date,
      startTime: '10:00',
      endTime: '12:00',
      explanation: 'Keep free',
    })
  ).rejects.toThrow('protected');
  expect(proposalService.create).not.toHaveBeenCalled();
});
it('delegates full planning with the resolved date and cumulative guidance', async () => {
  jest.mocked(generateDayPlan).mockResolvedValue({ id: id(2), report: { summary: 'Plan' } } as any);
  await planInstruction('owner', id(9), {
    type: 'generate',
    date: '2026-10-21',
    guidance: 'Keep morning light; prioritize report',
  });
  expect(generateDayPlan).toHaveBeenCalledWith('owner', {
    requestId: id(9),
    date: '2026-10-21',
    mode: 'ai',
    guidance: 'Keep morning light; prioritize report',
  });
});
it('rejects a DST gap rather than silently shifting wall times', async () => {
  await expect(
    planInstruction('owner', id(9), {
      type: 'reserve',
      date: '2026-03-29',
      startTime: '02:30',
      endTime: '03:30',
      explanation: 'Free',
    })
  ).rejects.toThrow('does not exist');
});
it('rejects extensions crossing the selected local day', async () => {
  jest.mocked(proposalService.context).mockResolvedValue({
    timezone: 'Europe/Amsterdam',
    baseHash: 'a'.repeat(64),
    blocks: [{ ...block, endsAt: '2026-10-20T21:45:00.000Z' }],
    candidates: [],
  });
  await expect(planInstruction('owner', id(9), replan())).rejects.toThrow('crosses midnight');
});
it('refines a pending generated addition in place and preserves unrelated changes', async () => {
  const addition = {
    type: 'add' as const,
    block: {
      kind: 'TASK' as const,
      taskId: id(7),
      occurrenceId: null,
      startsAt: '2026-10-20T12:00:00.000Z',
      endsAt: '2026-10-20T12:30:00.000Z',
    },
    explanation: 'Chosen for today',
  };
  jest.mocked(prisma.planningProposal.findFirst).mockResolvedValue({
    id: id(8),
    baseHash: 'a'.repeat(64),
    document: {
      schemaVersion: 1,
      generation: {
        requestHash: 'hash',
        mode: 'ai',
        model: null,
        guidance: 'Prioritize research',
        summary: 'Original allocation',
        selectionSummary: 'Chosen for deadline',
        warnings: [],
        outcomes: [
          {
            key: 'task',
            title: 'New task',
            remainingMinutes: 30,
            scheduledMinutes: 30,
            reason: 'Placed in open time',
            selectionReason: 'Thesis deadline',
            deadlineRisk: false,
          },
        ],
      },
      operations: [
        addition,
        {
          ...addition,
          block: {
            ...addition.block,
            taskId: id(6),
            startsAt: '2026-10-20T13:00:00.000Z',
            endsAt: '2026-10-20T13:30:00.000Z',
          },
        },
      ],
    },
    preview: {
      changes: [
        {
          type: 'add',
          explanation: 'Chosen for today',
          before: null,
          after: {
            ...block,
            id: 'new:0',
            title: 'New task',
            startsAt: addition.block.startsAt,
            endsAt: addition.block.endsAt,
            durationMinutes: 30,
          },
        },
      ],
      warnings: [],
      remaining: [],
    },
  } as any);
  await planInstruction(
    'owner',
    id(9),
    {
      type: 'edit',
      date,
      action: 'move',
      blockQuery: 'New task',
      candidateQuery: null,
      startTime: '16:00',
      endTime: '16:30',
      explanation: 'Later',
    },
    { date, proposalId: id(8) } as any
  );
  const document = jest.mocked(proposalService.create).mock.calls[0][1].document;
  expect(document.operations).toHaveLength(2);
  expect(document.operations[0]).toEqual({
    ...addition,
    block: {
      ...addition.block,
      startsAt: '2026-10-20T14:00:00.000Z',
      endsAt: '2026-10-20T14:30:00.000Z',
    },
    explanation: 'Later',
  });
  expect(document.operations[1]).toMatchObject({ block: { taskId: id(6) } });
  expect(document.generation).toBeUndefined();
  expect(document.selectionExplanation).toEqual({
    summary: 'Chosen for deadline',
    reasons: [{ title: 'New task', reason: 'Thesis deadline' }],
  });
  await planInstruction(
    'owner',
    id(10),
    {
      type: 'reserve',
      date,
      startTime: '14:00',
      endTime: '14:30',
      explanation: 'Keep this slot free',
    },
    { date, proposalId: id(8) }
  );
  const reserved = jest.mocked(proposalService.create).mock.calls[1][1].document;
  expect(reserved.operations).toHaveLength(1);
  expect(reserved.operations[0]).toMatchObject({ block: { taskId: id(6) } });
  expect(reserved.freeIntervals).toHaveLength(1);
  expect(reserved.selectionExplanation?.summary).toBe('Chosen for deadline');
});
it('asks for missing edit times instead of guessing', async () => {
  await expect(
    planInstruction('owner', id(9), {
      type: 'edit',
      date,
      action: 'move',
      blockQuery: block.id,
      candidateQuery: null,
      startTime: null,
      endTime: null,
      explanation: 'Later',
    })
  ).rejects.toThrow('What start and end');
  expect(proposalService.createEdit).not.toHaveBeenCalled();
});
it('requires explicit review when the saved plan timezone differs from the user preference', async () => {
  await expect(
    planInstruction('owner', id(9), replan(), undefined, 'America/New_York')
  ).rejects.toThrow('saved plan uses Europe/Amsterdam');
  expect(proposalService.replan).not.toHaveBeenCalled();
});
