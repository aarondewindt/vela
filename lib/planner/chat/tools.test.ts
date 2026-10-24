/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('./records', () => ({ workspaceRecords: { propose: jest.fn(), find: jest.fn() } }));
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
import { planningTools, planningGuidance } from './tools';

const date = '2030-01-07';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const generation = { date, guidance: 'Prioritize thesis work' };
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
  jest.mocked(generateDayPlan).mockResolvedValue({
    id: id(1),
    report: { summary: 'Existing scheduler', outcomes: [], warnings: [] },
  } as any);
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
it('forwards all constraints as scheduler guidance without classifying or rejecting them', async () => {
  const guidance = 'Keep after 17:00 free, clean for max 30 minutes, and work at home.';
  await execute(planningTools('owner', 'turn'), 'generateDayPlan', { date, guidance });
  expect(generateDayPlan).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({ date, guidance })
  );
});
it('exposes only date and guidance for scheduling instead of asking chat to define hard requirements', () => {
  const schema = planningTools('owner', 'turn').generateDayPlan.inputSchema as any;
  expect(schema.parse({ date, guidance: 'Plan the rest of the day' })).toEqual({
    date,
    guidance: 'Plan the rest of the day',
  });
  expect(() => schema.parse({ date, guidance: '', hardConstraints: [] })).toThrow();
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
it('keeps inventory mutations separate from scheduling and rejects foreign proposal arguments', () => {
  const tools = planningTools('owner', 'turn');
  expect(() =>
    (tools.proposeScheduleChanges.inputSchema as any).parse({ type: 'record', entity: 'task' })
  ).toThrow();
  expect(() =>
    (tools.reviewDayPlan.inputSchema as any).parse({ date, proposalId: id(8) })
  ).toThrow();
});

it('plans the remaining day with saved availability, approximate durations and a supported cleaning cap', async () => {
  const guidance =
    'Work on Vela for maybe another hour, then clean my room for max 30min, spend most of the evening on the solocos video, and practice guitar for a bit.';
  const response = await execute(planningTools('owner', 'duration-turn'), 'generateDayPlan', {
    date,
    guidance,
  });
  expect(response.proposalId).toBe(id(1));
  expect(generateDayPlan).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({
      guidance,
    })
  );
  expect(response.reply).not.toContain('availability editor');
});
it('keeps the original message intact when chat summarizes its interpretation', async () => {
  const original = 'Vela maybe an hour; room max 30min; most evening on video; some guitar.';
  await execute(planningTools('owner', 'turn', undefined, undefined, original), 'generateDayPlan', {
    date,
    guidance: 'Focus on the video',
  });
  expect(jest.mocked(generateDayPlan).mock.calls[0][1].guidance).toContain(original);
  expect(planningGuidance('x'.repeat(2000), 'context')).toBe('x'.repeat(2000));
  expect(planningGuidance('latest', 'x'.repeat(2000))).toHaveLength(2000);
});

it('replaces multiple preview blocks without requiring an edit discriminator or invented times', async () => {
  const input = {
    date,
    blockQueries: ['new:3', 'new:4', 'new:5'],
    candidateQuery: id(6),
    explanation: 'SoLocos after 20:30',
  };
  await execute(
    planningTools('owner', 'turn', { date, proposalId: id(1) }),
    'replaceScheduledBlocks',
    input
  );
  expect(planInstruction).toHaveBeenCalledWith(
    'owner',
    expect.any(String),
    { ...input, type: 'replaceBlocks' },
    { date, proposalId: id(1) },
    undefined
  );
  expect(proposalService.discard).toHaveBeenCalledWith('owner', id(1));
  expect(proposalService.accept).not.toHaveBeenCalled();
});
it('reports actual allocations and omissions to chat instead of only the total', async () => {
  jest.mocked(generateDayPlan).mockResolvedValue({
    id: id(1),
    report: {
      summary: 'Planned 229 minutes',
      outcomes: [
        { title: 'Work on Vela', scheduledMinutes: 229, reason: 'Placed in four blocks' },
        { title: 'SoLocos blooper video', scheduledMinutes: 0, reason: 'Not selected' },
      ],
      warnings: ['Some requested work remains unscheduled'],
    },
  } as any);
  const response = await execute(planningTools('owner', 'turn'), 'generateDayPlan', generation);
  expect(response.reply).toContain('Work on Vela: 229 minutes scheduled');
  expect(response.reply).toContain('SoLocos blooper video: 0 minutes scheduled');
  expect(response.reply).toContain('Some requested work remains unscheduled');
});

it('uses a separate inventory tool, normalizes relative deadlines and returns application-owned preview references', async () => {
  const { workspaceRecords } = await import('./records');
  jest.mocked(workspaceRecords.propose).mockResolvedValue({
    id: id(1),
    preview: { entity: 'task', action: 'create', patch: { title: 'Report' } },
  } as any);
  const tools = planningTools(
    'owner',
    `${id(9)}:message`,
    undefined,
    'Pacific/Kiritimati',
    'Create Report due tomorrow',
    id(9),
    date
  );
  const response = await execute(tools, 'proposeRecordChange', {
    entity: 'task',
    action: 'create',
    query: null,
    task: { title: 'Report' },
    theme: null,
  });
  expect(workspaceRecords.propose).toHaveBeenCalledWith(
    'owner',
    id(9),
    expect.any(String),
    expect.objectContaining({
      type: 'record',
      task: { title: 'Report', dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    }),
    'message',
    false
  );
  expect(response).toMatchObject({ date, recordProposalId: id(1) });
  expect(generateDayPlan).not.toHaveBeenCalled();
  expect(tools).not.toHaveProperty('acceptRecord');
});
it('returns bounded ambiguity choices rather than applying an arbitrary record', async () => {
  const { workspaceRecords } = await import('./records');
  jest
    .mocked(workspaceRecords.propose)
    .mockRejectedValue(new Clarification('Which Report?', [{ id: id(1), label: 'Report' }]));
  const response = await execute(
    planningTools('owner', `${id(9)}:message`, undefined, undefined, '', id(9), date),
    'proposeRecordChange',
    {
      entity: 'task',
      action: 'delete',
      query: 'Report',
      task: null,
      theme: null,
    }
  );
  expect(response).toMatchObject({
    reply: 'Which Report?',
    matches: [{ id: id(1), label: 'Report' }],
  });
});

it('revises pending creations without asking the model to identify a saved task or repeat its action', async () => {
  const { workspaceRecords } = await import('./records');
  jest
    .mocked(workspaceRecords.propose)
    .mockResolvedValue({ id: id(1), preview: { entity: 'task', action: 'create' } } as any);
  const tools = planningTools(
    'owner',
    `${id(9)}:message`,
    undefined,
    undefined,
    'Make that 60 minutes',
    id(9),
    date
  );
  const response = await execute(tools, 'reviseRecordChange', { task: { estimatedMinutes: 60 } });
  expect(workspaceRecords.propose).toHaveBeenCalledWith(
    'owner',
    id(9),
    expect.any(String),
    expect.objectContaining({ task: { estimatedMinutes: 60 } }),
    'message',
    true
  );
  expect(response.recordProposalId).toBe(id(1));
});
