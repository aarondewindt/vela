/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('./records', () => ({ workspaceRecords: { propose: jest.fn(), find: jest.fn() } }));
jest.mock('ai', () => ({ tool: (value: unknown) => value }));
jest.mock('../drafts/generation', () => ({ generateWorkingDraft: jest.fn() }));
jest.mock('../drafts/planning', () => ({ draftInstruction: jest.fn() }));
jest.mock('../drafts/service', () => ({
  draftService: { byRequest: jest.fn(), read: jest.fn(), snapshot: jest.fn(), accept: jest.fn() },
}));
jest.mock('../proposals/service', () => ({ proposalService: { list: jest.fn(), get: jest.fn() } }));
jest.mock('../review/service', () => ({ reviewDayPlan: jest.fn() }));
jest.mock('./context', () => ({ plannerChatContext: jest.fn() }));
import { generateWorkingDraft } from '../drafts/generation';
import { draftInstruction } from '../drafts/planning';
import { draftService } from '../drafts/service';
import { reviewDayPlan } from '../review/service';
import { Clarification } from '../conversation/resolve';
import { planningTools, planningGuidance } from './tools';
const date = '2030-01-07';
const id = '00000000-0000-4000-8000-000000000001';
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
  return (operation.execute as any)((operation.inputSchema as any).parse(input), {
    toolCallId: 'call',
    messages: [],
  });
}
beforeEach(() => {
  jest.resetAllMocks();
  jest
    .mocked(draftService.read)
    .mockResolvedValue({ draft: { id, version: 3 }, activePlanId: null } as any);
  jest
    .mocked(draftInstruction)
    .mockResolvedValue({ date, reply: 'Updated the draft.', draftUpdated: true });
});
it('calls the shared draft generator with independent model configuration and no acceptance tool', async () => {
  const tools = planningTools('owner', 'turn');
  const result = await execute(tools, 'generateDayPlan', { date, guidance: 'Prioritize thesis' });
  expect(generateWorkingDraft).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({
      date,
      draftId: id,
      expectedVersion: 3,
      mode: 'ai',
      guidance: 'Prioritize thesis',
      rebuild: false,
    })
  );
  expect(jest.mocked(generateWorkingDraft).mock.calls[0][1]).not.toHaveProperty('selection');
  expect(result).toEqual({ date, reply: 'Draft schedule updated.', draftUpdated: true });
  expect(draftService.accept).not.toHaveBeenCalled();
  expect(tools).not.toHaveProperty('accept');
});
it('keeps generation guidance bounded and preserves the latest request', () => {
  const latest = 'Clean for an hour then prioritize thesis';
  expect(planningGuidance(latest, 'x'.repeat(2000))).toHaveLength(2000);
  expect(planningGuidance(latest, 'Prior preference')).toMatch(/^Clean for an hour/);
});
it('recovers a stable saved request without another model call or draft mutation', async () => {
  await execute(planningTools('owner', 'turn'), 'generateDayPlan', { date, guidance: '' });
  const requestId = jest.mocked(generateWorkingDraft).mock.calls[0][1].requestId;
  jest.mocked(draftService.byRequest).mockResolvedValue({ requestId } as any);
  await execute(planningTools('owner', 'turn'), 'generateDayPlan', { date, guidance: '' });
  expect(generateWorkingDraft).toHaveBeenCalledTimes(1);
  expect(draftService.byRequest).toHaveBeenLastCalledWith('owner', requestId);
});
it('passes explicit rebuild separately from normal guidance', async () => {
  await execute(planningTools('owner', 'turn'), 'generateDayPlan', {
    date,
    guidance: 'Rebuild',
    rebuild: true,
  });
  expect(generateWorkingDraft).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({ rebuild: true })
  );
});
it('edits the date draft without conversation-owned proposals', async () => {
  await execute(
    planningTools('owner', 'turn', { date, proposalId: id }, 'UTC'),
    'proposeScheduleChanges',
    edit
  );
  expect(draftInstruction).toHaveBeenCalledWith('owner', expect.any(String), edit, 'UTC');
});
it('returns ambiguity clarification without creating a draft', async () => {
  jest.mocked(draftInstruction).mockRejectedValue(new Clarification('Which task?'));
  expect(await execute(planningTools('owner', 'turn'), 'proposeScheduleChanges', edit)).toEqual({
    date,
    reply: 'Which task?',
  });
  expect(generateWorkingDraft).not.toHaveBeenCalled();
});
it('preserves saved drafts when generation fails and surfaces the failure', async () => {
  jest.mocked(generateWorkingDraft).mockRejectedValue(new Error('Ollama unavailable'));
  expect(
    await execute(planningTools('owner', 'turn'), 'generateDayPlan', { date, guidance: '' })
  ).toMatchObject({ draftFailed: true });
  expect(draftService.accept).not.toHaveBeenCalled();
});
it('reviews the existing draft snapshot without creating or editing a draft', async () => {
  const snapshot = { hash: 'saved-snapshot' };
  jest
    .mocked(draftService.snapshot)
    .mockResolvedValue({ snapshot, draft: { id, version: 3 } } as any);
  jest.mocked(reviewDayPlan).mockResolvedValue({
    guidance: '',
    conflicts: [],
    concerns: [],
    corrections: [],
    blocks: [],
    warnings: [],
    aiError: null,
  } as any);
  await execute(planningTools('owner', 'turn'), 'reviewDayPlan', { date, mode: 'deterministic' });
  expect(reviewDayPlan).toHaveBeenCalledWith('owner', expect.objectContaining({ date }), snapshot);
  expect(generateWorkingDraft).not.toHaveBeenCalled();
  expect(draftInstruction).not.toHaveBeenCalled();
});
