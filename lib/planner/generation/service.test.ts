/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: { $transaction: jest.fn(), planningProposal: { findUnique: jest.fn() } },
}));
jest.mock('@/lib/ai/structured', () => ({ generateStructured: jest.fn() }));
jest.mock('@/lib/model-settings/service', () => ({ requireModelSelection: jest.fn() }));
jest.mock('@/lib/task-search/service', () => ({
  taskSearchService: { status: jest.fn(), search: jest.fn() },
}));
jest.mock('@/lib/task-reviews/service', () => ({
  taskReviewService: { schedulerContext: jest.fn() },
}));
jest.mock('../proposals/service', () => ({ proposalService: { create: jest.fn() } }));
import { taskReviewService } from '@/lib/task-reviews/service';
import { prisma } from '@/lib/prisma';
import { generateStructured } from '@/lib/ai/structured';
import { AiError } from '@/lib/ai/errors';
import { requireModelSelection } from '@/lib/model-settings/service';
import { taskSearchService } from '@/lib/task-search/service';
import { proposalService } from '../proposals/service';
import { generateDayPlan } from './service';
import { fixture, date, taskId } from './fixtures';

const input = {
  requestId: taskId(99),
  date,
  mode: 'ai' as const,
  guidance: 'Keep today light and focus on housework',
};
let s = fixture();
beforeEach(() => {
  jest.resetAllMocks();
  s = fixture();
  (taskReviewService.schedulerContext as jest.Mock).mockResolvedValue([]);
  (prisma.planningProposal.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.$transaction as jest.Mock).mockImplementation(async () => s);
  (requireModelSelection as jest.Mock).mockResolvedValue({
    provider: 'ollama',
    modelId: 'fixture-model',
  });
  (taskSearchService.status as jest.Mock).mockResolvedValue({ pending: 1 });
  (taskSearchService.search as jest.Mock).mockResolvedValue({ results: [] });
  (proposalService.create as jest.Mock).mockResolvedValue({ id: taskId(100) });
  (generateStructured as jest.Mock).mockResolvedValue({
    summary: 'A lighter day focused on the first task.',
    workBudgetMinutes: 30,
    selected: [{ key: 'C1', reason: 'Housework focus' }],
    omitted: [{ key: 'C2', reason: 'Keep capacity light' }],
  });
});

it('uses centralized settings, current task context and the validated proposal boundary without changing planning data', async () => {
  const before = JSON.stringify(s);
  const result = await generateDayPlan('owner', input);
  expect(requireModelSelection).toHaveBeenCalledWith('owner', 'planner.dayPlan');
  expect(taskSearchService.search).toHaveBeenCalledWith(
    'owner',
    input.guidance,
    30,
    expect.any(AbortSignal)
  );
  expect(JSON.parse((generateStructured as jest.Mock).mock.calls[0][0].prompt)).toMatchObject({
    guidance: input.guidance,
    candidates: [
      expect.objectContaining({ remainingMinutes: 60 }),
      expect.objectContaining({ remainingMinutes: 45 }),
    ],
  });
  expect(proposalService.create).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({
      baseHash: s.hash,
      document: expect.objectContaining({
        generation: expect.objectContaining({
          model: { provider: 'ollama', modelId: 'fixture-model' },
        }),
      }),
    })
  );
  expect(result.report.outcomes).toMatchObject([
    { scheduledMinutes: 30, remainingMinutes: 30 },
    { scheduledMinutes: 0, remainingMinutes: 45, selectionReason: 'Keep capacity light' },
  ]);
  expect(JSON.stringify(s)).toBe(before);
  expect(result.report.summary).toBe(
    'Planned 30 task minutes across 1 task. 75 task minutes remain unscheduled.'
  );
  expect(result.report.selectionSummary).toBe('A lighter day focused on the first task.');
  expect(result.report.reviewBy).toBe(`${date}T09:00:00.000Z`);
});

it('retains due/important candidates independently of semantic top-k', async () => {
  s = fixture(Array(65).fill(30));
  s.tasks[64].priority = 1;
  (generateStructured as jest.Mock).mockImplementation(async ({ prompt }) => ({
    summary: 'Urgent first',
    workBudgetMinutes: 30,
    selected: [],
    omitted: JSON.parse(prompt).candidates.map((c: { key: string }) => ({
      key: c.key,
      reason: 'Not enough capacity',
    })),
  }));
  const result = await generateDayPlan('owner', input);
  const prompt = JSON.parse((generateStructured as jest.Mock).mock.calls[0][0].prompt);
  expect(prompt.candidates).toHaveLength(60);
  expect(prompt.candidates).toContainEqual(
    expect.objectContaining({ key: 'C1', title: 'Task 65', mustConsider: true })
  );
  expect(result.report.outcomes).toHaveLength(65);
});

it('uses current context and reports semantic retrieval failure', async () => {
  (taskSearchService.search as jest.Mock).mockRejectedValue(
    new AiError('PROVIDER_UNAVAILABLE', 'Unavailable')
  );
  const result = await generateDayPlan('owner', input);
  expect(result.report.warnings.join()).toMatch(/retrieval is unavailable/);
  expect(generateStructured).toHaveBeenCalled();
});

it('fills remaining eligible work when no guidance was supplied, even with a small AI shortlist and budget', async () => {
  (generateStructured as jest.Mock).mockResolvedValue({
    summary: 'Shortlist',
    workBudgetMinutes: 30,
    selected: [{ key: 'C1', reason: 'Preferred' }],
    omitted: [],
  });
  const result = await generateDayPlan('owner', { ...input, guidance: '' });
  expect(result.report).toMatchObject({
    planningGoal: 'fill',
    workBudgetMinutes: null,
    additionalCandidateCount: 1,
  });
  expect(result.report.outcomes.map((outcome) => outcome.scheduledMinutes)).toEqual([60, 45]);
  expect(result.report.outcomes[1].selectionReason).toMatch(/Application fill pass/);
  expect(result.report.availableWindows).toEqual([
    { startsAt: `${date}T09:00:00.000Z`, endsAt: `${date}T17:00:00.000Z` },
  ]);
});

it('records guided workload decisions explicitly in the report', async () => {
  const result = await generateDayPlan('owner', input);
  expect(result.report).toMatchObject({
    planningGoal: 'guided',
    workBudgetMinutes: 30,
    additionalCandidateCount: 0,
  });
  expect(result.report.outcomes.map((outcome) => outcome.scheduledMinutes)).toEqual([30, 0]);
});

it('creates a proposal when the model selects a subset and skips omission bookkeeping', async () => {
  (generateStructured as jest.Mock).mockResolvedValue({
    summary: 'Focus on housework',
    workBudgetMinutes: 30,
    selected: [{ key: 'C1', reason: 'Housework focus' }],
    omitted: [],
  });
  const result = await generateDayPlan('owner', input);
  expect(result.id).toBe(taskId(100));
  expect(result.report.outcomes).toMatchObject([
    { key: `${taskId(1)}:new`, scheduledMinutes: 30 },
    {
      key: `${taskId(2)}:new`,
      scheduledMinutes: 0,
      remainingMinutes: 45,
      selectionReason: expect.stringContaining('did not select'),
    },
  ]);
  expect(result.report.warnings.join()).toMatch(/1 candidates unassessed/);
  const document = (proposalService.create as jest.Mock).mock.calls[0][1].document;
  expect(document.operations[0].block.taskId).toBe(taskId(1));
  expect(JSON.stringify(document)).not.toContain('"C1"');
});

it('propagates unexpected retrieval errors rather than swallowing failures', async () => {
  (taskSearchService.status as jest.Mock).mockRejectedValue(new Error('Database failed'));
  await expect(generateDayPlan('owner', input)).rejects.toThrow('Database failed');
  expect(generateStructured).not.toHaveBeenCalled();
});

it.each([
  { selected: [{ key: 'foreign', reason: 'Invalid' }], omitted: [] },
  {
    selected: [
      { key: 'C1', reason: 'Repeated' },
      { key: 'C1', reason: 'Repeated' },
    ],
    omitted: [],
  },
])('rejects unknown and repeated model references: %j', async (choices) => {
  (generateStructured as jest.Mock).mockResolvedValue({
    summary: 'Bad output',
    workBudgetMinutes: null,
    ...choices,
  });
  await expect(generateDayPlan('owner', input)).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
  });
  expect(proposalService.create).not.toHaveBeenCalled();
});

it('corrects a repeated reference once within a shared inference deadline, then validates the result', async () => {
  const model = generateStructured as jest.Mock;
  model.mockResolvedValueOnce({
    summary: 'Duplicate',
    workBudgetMinutes: 30,
    selected: [
      { key: 'C1', reason: 'First' },
      { key: 'C1', reason: 'Again' },
    ],
    omitted: [],
  });
  const result = await generateDayPlan('owner', input);
  expect(result.report.outcomes.map((outcome) => outcome.scheduledMinutes)).toEqual([30, 0]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(model.mock.calls[1][0].signal).toBe(model.mock.calls[0][0].signal);
  expect(model.mock.calls[1][0].prompt).toContain(
    'previous response had invalid or repeated candidate references'
  );
});

it('preserves the plan on AI failure and offers an explicit deterministic option', async () => {
  (generateStructured as jest.Mock).mockRejectedValue(
    new AiError('PROVIDER_UNAVAILABLE', 'Unavailable')
  );
  await expect(generateDayPlan('owner', input)).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
    message: expect.stringMatching(/deterministic/),
  });
  expect(proposalService.create).not.toHaveBeenCalled();
  const result = await generateDayPlan('owner', { ...input, mode: 'deterministic' });
  expect(result.report.model).toBeNull();
  expect(result.report.outcomes.map((o) => o.scheduledMinutes)).toEqual([60, 45]);
  expect(requireModelSelection).toHaveBeenCalledTimes(1);
});

it('replays a saved generated request without model resolution, inference or current-state dependence', async () => {
  const first = await generateDayPlan('owner', input);
  const document = (proposalService.create as jest.Mock).mock.calls[0][1].document;
  (prisma.planningProposal.findUnique as jest.Mock).mockResolvedValue({ id: first.id, document });
  jest.mocked(generateStructured).mockClear();
  jest.mocked(requireModelSelection).mockClear();
  jest.mocked(prisma.$transaction).mockClear();
  expect(await generateDayPlan('owner', input)).toEqual(first);
  expect(generateStructured).not.toHaveBeenCalled();
  expect(requireModelSelection).not.toHaveBeenCalled();
  expect(prisma.$transaction).not.toHaveBeenCalled();
  await expect(generateDayPlan('owner', { ...input, guidance: 'Changed' })).rejects.toMatchObject({
    code: 'CONFLICT',
  });
});

it('returns a report without writing a proposal when no additions or reservations fit', async () => {
  s.override = { workMode: 'PTO' } as typeof s.override;
  expect(await generateDayPlan('owner', { ...input, mode: 'deterministic' })).toMatchObject({
    id: null,
  });
  expect(proposalService.create).not.toHaveBeenCalled();
});

it('passes fresh saved task reviews as advisory context without changing recorded candidate properties', async () => {
  const before = JSON.stringify(s);
  const context = [
    {
      taskId: s.tasks[0].id,
      reviewId: taskId(101),
      summary: 'Clarify the deliverable.',
      focus: 2,
      dueDateRisk: 'unknown',
      suggestedFirstStep: 'Define done.',
      attribution: { provider: 'ollama', modelId: 'review-model' },
    },
  ];
  (taskReviewService.schedulerContext as jest.Mock).mockResolvedValue(context);
  await generateDayPlan('owner', input);
  const prompt = JSON.parse((generateStructured as jest.Mock).mock.calls[0][0].prompt);
  expect(prompt.taskReviews).toEqual(context);
  expect(JSON.stringify(s)).toBe(before);
});
