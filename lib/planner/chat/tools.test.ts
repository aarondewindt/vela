/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('ai', () => ({ tool: (value: unknown) => value }));
jest.mock('../generation/service', () => ({ generateDayPlan: jest.fn() }));
jest.mock('../conversation/planning', () => ({ planInstruction: jest.fn() }));
jest.mock('../proposals/service', () => ({
  proposalService: {
    byRequest: jest.fn(),
    get: jest.fn(),
    discard: jest.fn(),
    list: jest.fn(),
    accept: jest.fn(),
  },
}));
jest.mock('../review/service', () => ({ reviewDayPlan: jest.fn() }));
jest.mock('./context', () => ({ plannerChatContext: jest.fn() }));
import { generateDayPlan } from '../generation/service';
import { planInstruction } from '../conversation/planning';
import { proposalService } from '../proposals/service';
import { reviewDayPlan } from '../review/service';
import { Clarification } from '../conversation/resolve';
import { planningTools } from './tools';

const date = '2030-01-07';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const generation = { date, guidance: 'Prioritize thesis work', hardConstraints: [], freeTimes: [] };
const edit = {
  type: 'edit',
  date,
  action: 'move',
  blockQuery: 'Thesis',
  candidateQuery: null,
  startTime: '09:00',
  endTime: '10:00',
  explanation: 'Morning',
};
async function execute(
  tools: ReturnType<typeof planningTools>,
  name: keyof ReturnType<typeof planningTools>,
  input: unknown
) {
  const operation = tools[name];
  // Exercise the same schema-validation boundary used by the SDK.
  const parsed = (operation.inputSchema as any).parse(input);
  return (operation.execute as any)(parsed, { toolCallId: 'call', messages: [] });
}
beforeEach(() => {
  jest.resetAllMocks();
  jest
    .mocked(generateDayPlan)
    .mockResolvedValue({ id: id(1), report: { summary: 'Existing scheduler' } } as any);
  jest.mocked(proposalService.get).mockResolvedValue({
    id: id(1),
    status: 'PENDING',
    date,
    invalidReason: null,
    preview: { changes: [] },
  } as any);
  jest.mocked(planInstruction).mockResolvedValue({ proposalId: id(2), reply: 'Revision' });
});
it('calls the existing scheduler with an independent scheduler model and leaves approval to the application', async () => {
  const tools = planningTools('owner', 'turn');
  const response = await execute(tools, 'generateDayPlan', generation);
  expect(generateDayPlan).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({ date, mode: 'ai', guidance: generation.guidance })
  );
  expect(jest.mocked(generateDayPlan).mock.calls[0][1]).not.toHaveProperty('model');
  expect(response).toMatchObject({ date, proposalId: id(1) });
  expect(proposalService.accept).not.toHaveBeenCalled();
  expect(tools).not.toHaveProperty('accept');
});
it('rejects unsupported hard restrictions instead of forwarding them as scheduler guidance', async () => {
  const response = await execute(planningTools('owner', 'turn'), 'generateDayPlan', {
    ...generation,
    hardConstraints: ['Work at home only'],
  });
  expect(response.reply).toContain('cannot enforce');
  expect(generateDayPlan).not.toHaveBeenCalled();
});
it('passes explicit local free intervals through the shared scheduler pipeline', async () => {
  await execute(planningTools('owner', 'turn'), 'generateDayPlan', {
    ...generation,
    freeTimes: [{ startTime: '17:00', endTime: '24:00' }],
  });
  expect(generateDayPlan).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({ freeTimes: [{ startTime: '17:00', endTime: '24:00' }] })
  );
});
it('uses stable owner/turn/argument identities for retries and recovers a saved result without inference', async () => {
  await execute(planningTools('owner', 'turn'), 'generateDayPlan', generation);
  const first = jest.mocked(generateDayPlan).mock.calls[0][1].requestId;
  await execute(planningTools('owner', 'turn'), 'generateDayPlan', generation);
  expect(jest.mocked(generateDayPlan).mock.calls[1][1].requestId).toBe(first);
  jest.mocked(proposalService.byRequest).mockResolvedValue({ id: id(1) } as any);
  await execute(planningTools('owner', 'turn'), 'generateDayPlan', generation);
  expect(generateDayPlan).toHaveBeenCalledTimes(2);
  expect(proposalService.byRequest).toHaveBeenLastCalledWith('owner', first);
});
it('composes with pending context and discards the superseded preview only after success', async () => {
  const tools = planningTools('owner', 'turn', { date, proposalId: id(1) });
  await execute(tools, 'proposeScheduleChanges', edit);
  expect(planInstruction).toHaveBeenCalledWith(
    'owner',
    expect.any(String),
    edit,
    {
      date,
      proposalId: id(1),
    },
    undefined
  );
  expect(proposalService.discard).toHaveBeenCalledWith('owner', id(1));
  expect(proposalService.accept).not.toHaveBeenCalled();
});
it('serializes concurrent model calls so later revisions see the newly created proposal', async () => {
  const tools = planningTools('owner', 'turn');
  await Promise.all([
    execute(tools, 'generateDayPlan', generation),
    execute(tools, 'proposeScheduleChanges', edit),
  ]);
  expect(planInstruction).toHaveBeenCalledWith(
    'owner',
    expect.any(String),
    edit,
    {
      date,
      proposalId: id(1),
    },
    undefined
  );
});
it('preserves the pending preview on ambiguity, stale state or failures', async () => {
  const tools = planningTools('owner', 'turn', { date, proposalId: id(1) });
  jest.mocked(planInstruction).mockRejectedValue(new Clarification('Which block?'));
  expect(await execute(tools, 'proposeScheduleChanges', edit)).toMatchObject({
    reply: 'Which block?',
  });
  expect(proposalService.discard).not.toHaveBeenCalled();
  jest
    .mocked(proposalService.get)
    .mockResolvedValue({ status: 'PENDING', invalidReason: 'Stale preview' } as any);
  expect(await execute(tools, 'proposeScheduleChanges', edit)).toMatchObject({
    reply: 'Stale preview',
  });
  expect(proposalService.accept).not.toHaveBeenCalled();
});
it('does not carry a pending proposal across dates', async () => {
  await execute(
    planningTools('owner', 'turn', { date: '2030-01-08', proposalId: id(1) }),
    'proposeScheduleChanges',
    edit
  );
  expect(planInstruction).toHaveBeenCalledWith(
    'owner',
    expect.any(String),
    edit,
    undefined,
    undefined
  );
});
it('reuses the review service and returns separated structured findings', async () => {
  jest.mocked(reviewDayPlan).mockResolvedValue({
    date,
    guidance: '',
    conflicts: [
      { code: 'OVERLAP', blockIds: [id(4)], taskIds: [], explanation: 'Verified overlap' },
    ],
    concerns: [],
    corrections: [],
    blocks: [],
    warnings: [],
    aiError: null,
  } as any);
  const response = await execute(
    planningTools('owner', 'turn', { date, proposalId: id(1) }),
    'reviewDayPlan',
    { date, mode: 'deterministic', guidance: '' }
  );
  expect(reviewDayPlan).toHaveBeenCalledWith('owner', {
    date,
    mode: 'deterministic',
    guidance: '',
    proposalId: id(1),
  });
  expect(response.review.conflicts[0].code).toBe('OVERLAP');
  expect(generateDayPlan).not.toHaveBeenCalled();
});
it('answers explanation questions from stored results without new scheduler or review calls', async () => {
  jest.mocked(proposalService.get).mockResolvedValue({
    status: 'APPLIED',
    preview: { generation: { summary: 'Chosen for urgency', outcomes: [] }, changes: [] },
  } as any);
  const response = await execute(
    planningTools('owner', 'turn', { date, proposalId: id(1) }),
    'explainPlanningDecision',
    { date }
  );
  expect(response.reply).toContain('Chosen for urgency');
  expect(generateDayPlan).not.toHaveBeenCalled();
  expect(reviewDayPlan).not.toHaveBeenCalled();
});
it('does not expose record CRUD, database access or foreign proposal arguments', () => {
  const tools = planningTools('owner', 'turn');
  expect(() =>
    (tools.proposeScheduleChanges.inputSchema as any).parse({ type: 'record', entity: 'task' })
  ).toThrow();
  expect(() =>
    (tools.reviewDayPlan.inputSchema as any).parse({ date, proposalId: id(8) })
  ).toThrow();
});
