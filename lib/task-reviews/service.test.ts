/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({ prisma: { $transaction: jest.fn() } }));
jest.mock('@/lib/ai/structured', () => ({ generateStructured: jest.fn() }));
jest.mock('@/lib/model-settings/service', () => ({ requireModelSelection: jest.fn() }));
jest.mock('./source', () => ({ loadReviewSource: jest.fn() }));
import { prisma } from '@/lib/prisma';
import { generateStructured } from '@/lib/ai/structured';
import { AiError } from '@/lib/ai/errors';
import { requireModelSelection } from '@/lib/model-settings/service';
import { loadReviewSource } from './source';
import { REVIEW_PROMPT_VERSION, taskReviewService } from './service';
import { acceptReviewInput, reviewDocumentSchema } from './schema';

export const document = {
  summary: 'Draft outcome needs clarification.',
  recordedFacts: ['Task is in backlog.'],
  inferredContext: ['Scope may be broad.'],
  missingInformation: ['Completion criteria.'],
  priority: { value: 2, explanation: 'Due soon.' },
  size: { value: 3, explanation: 'Moderate scope.' },
  estimatedMinutes: { value: 60, explanation: 'Total effort estimate from scope.' },
  focus: { value: 2, explanation: 'Outcome identified, scope unclear.' },
  dueDateRisk: { value: 'unknown', explanation: 'No deadline recorded.' },
  firstStep: {
    value: 'Spend ten minutes drafting completion criteria.',
    explanation: 'Clarify scope.',
  },
  themeId: { value: null, explanation: 'Keep theme.' },
  category: { value: null, explanation: 'Keep category.' },
  brief: { value: 'A concise task brief.', explanation: 'Summarizes recorded scope.' },
  tags: { value: ['writing', 'report'], explanation: 'Reflects task content.' },
  nextSteps: ['Confirm scope.'],
  blockers: [{ blocker: 'Scope unknown.', unblock: 'Define done.' }],
};
const taskId = '00000000-0000-4000-8000-000000000001';
const id = '00000000-0000-4000-8000-000000000002';
const tx = {
  $executeRaw: jest.fn(),
  taskReview: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  task: { updateMany: jest.fn() },
  theme: { findFirst: jest.fn() },
};
const review = () => ({
  id,
  userId: 'owner',
  taskId,
  sourceHash: 'source1',
  source: { version: 2, availableThemes: [] },
  document,
  promptVersion: REVIEW_PROMPT_VERSION,
  modelId: 'model',
  provider: 'ollama',
  acceptedAt: null,
});
beforeEach(() => {
  jest.resetAllMocks();
  (prisma.$transaction as jest.Mock).mockImplementation((run) => run(tx));
  (loadReviewSource as jest.Mock).mockResolvedValue({
    source: { version: 2, availableThemes: [] },
    hash: 'source1',
  });
  (requireModelSelection as jest.Mock).mockResolvedValue({ provider: 'ollama', modelId: 'model' });
  (generateStructured as jest.Mock).mockResolvedValue(document);
  tx.taskReview.findFirst.mockResolvedValue(review());
  tx.taskReview.findMany.mockResolvedValue([review()]);
  tx.taskReview.create.mockImplementation(({ data }) => ({ id, ...data }));
});
it('saves source versions and actual model attribution without modifying the task', async () => {
  const result = await taskReviewService.generate('owner', { taskId });
  expect(requireModelSelection).toHaveBeenCalledWith('owner', 'planner.taskReview');
  expect(result).toMatchObject({ document, outdated: false });
  expect(tx.taskReview.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      userId: 'owner',
      taskId,
      sourceHash: 'source1',
      source: { version: 2, availableThemes: [] },
      provider: 'ollama',
      modelId: 'model',
      promptVersion: REVIEW_PROMPT_VERSION,
    }),
  });
  expect(tx.task.updateMany).not.toHaveBeenCalled();
});
it('marks a source changed during inference as outdated', async () => {
  (loadReviewSource as jest.Mock)
    .mockResolvedValueOnce({ source: { availableThemes: [] }, hash: 'old' })
    .mockResolvedValueOnce({ source: { availableThemes: [] }, hash: 'new' });
  expect(await taskReviewService.generate('owner', { taskId })).toMatchObject({ outdated: true });
});
it('preserves existing reviews and task properties when inference fails', async () => {
  (generateStructured as jest.Mock).mockRejectedValue(
    new AiError('PROVIDER_UNAVAILABLE', 'Unavailable')
  );
  await expect(taskReviewService.generate('owner', { taskId })).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
  });
  expect(tx.taskReview.create).not.toHaveBeenCalled();
  expect(tx.task.updateMany).not.toHaveBeenCalled();
});
it('applies only selected suggestions after source validation', async () => {
  await taskReviewService.accept('owner', { id, fields: ['priority', 'firstStep'] });
  expect(tx.taskReview.findFirst).toHaveBeenCalledWith({ where: { id, userId: 'owner' } });
  expect(tx.task.updateMany).toHaveBeenCalledWith({
    where: { id: taskId, userId: 'owner' },
    data: { priority: 2, firstStep: document.firstStep.value },
  });
  expect(tx.taskReview.update).toHaveBeenCalledWith({
    where: { id },
    data: {
      acceptedAt: expect.any(Date),
      acceptedFields: ['priority', 'firstStep'],
    },
  });
});
it.each(['changed source', 'old prompt', 'already accepted', 'other owner'])(
  'rejects %s before writing task properties',
  async (reason) => {
    if (reason === 'changed source') {
      (loadReviewSource as jest.Mock).mockResolvedValue({ hash: 'changed' });
    }
    if (reason === 'old prompt') {
      tx.taskReview.findFirst.mockResolvedValue({ ...review(), promptVersion: 'old' });
    }
    if (reason === 'already accepted') {
      tx.taskReview.findFirst.mockResolvedValue({ ...review(), acceptedAt: new Date() });
    }
    if (reason === 'other owner') {
      tx.taskReview.findFirst.mockResolvedValue(null);
    }
    await expect(
      taskReviewService.accept('owner', { id, fields: ['priority'] })
    ).rejects.toMatchObject({
      code: reason === 'other owner' ? 'NOT_FOUND' : 'CONFLICT',
    });
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  }
);
it('rejects unsupported, empty, duplicated or out-of-range suggestions', async () => {
  expect(acceptReviewInput.safeParse({ id, fields: ['status'] }).success).toBe(false);
  expect(acceptReviewInput.safeParse({ id, fields: [] }).success).toBe(false);
  expect(acceptReviewInput.safeParse({ id, fields: ['size', 'size'] }).success).toBe(false);
  expect(
    reviewDocumentSchema.safeParse({ ...document, focus: { value: 6, explanation: 'Bad' } }).success
  ).toBe(false);
  expect(
    reviewDocumentSchema.safeParse({
      ...document,
      estimatedMinutes: { value: -1, explanation: 'Bad' },
    }).success
  ).toBe(false);
  tx.taskReview.findFirst.mockResolvedValue({
    ...review(),
    document: { ...document, priority: { value: null, explanation: 'Unknown' } },
  });
  await expect(
    taskReviewService.accept('owner', { id, fields: ['priority'] })
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(tx.task.updateMany).not.toHaveBeenCalled();
});
it('returns outdated reviews for user inspection with owner-scoped access', async () => {
  (loadReviewSource as jest.Mock).mockResolvedValue({ hash: 'new' });
  expect(await taskReviewService.latest('owner', { taskId })).toMatchObject({ outdated: true });
  expect(tx.taskReview.findFirst.mock.calls[0][0].where).toEqual({ userId: 'owner', taskId });
});
it('only supplies fresh advisory context to the scheduler', async () => {
  expect(await taskReviewService.schedulerContext('owner', [taskId])).toEqual([
    expect.objectContaining({
      taskId,
      summary: document.summary,
      focus: 2,
      dueDateRisk: 'unknown',
    }),
  ]);
  (loadReviewSource as jest.Mock).mockResolvedValue({ hash: 'new' });
  expect(await taskReviewService.schedulerContext('owner', [taskId])).toEqual([]);
  expect(tx.task.updateMany).not.toHaveBeenCalled();
});

it('applies Theme, Category, Brief and Tags only when selected', async () => {
  const themeId = '00000000-0000-4000-8000-000000000003';
  tx.taskReview.findFirst.mockResolvedValue({
    ...review(),
    document: {
      ...document,
      themeId: { value: themeId, explanation: 'Matches this project.' },
      category: { value: 'LIFE', explanation: 'Personal work.' },
    },
  });
  tx.theme.findFirst.mockResolvedValue({ id: themeId });
  await taskReviewService.accept('owner', { id, fields: ['themeId', 'category', 'brief', 'tags'] });
  expect(tx.theme.findFirst).toHaveBeenCalledWith({
    where: { id: themeId, userId: 'owner', isActive: true },
    select: { id: true },
  });
  expect(tx.task.updateMany).toHaveBeenCalledWith({
    where: { id: taskId, userId: 'owner' },
    data: {
      themeId,
      category: 'LIFE',
      brief: document.brief.value,
      tags: document.tags.value,
    },
  });
});
it('supports explicitly clearing theme, category override, brief and tags', async () => {
  tx.taskReview.findFirst.mockResolvedValue({
    ...review(),
    document: {
      ...document,
      themeId: { value: 'NONE', explanation: 'No project applies.' },
      category: { value: 'INHERIT', explanation: 'Use theme category.' },
      brief: { value: '', explanation: 'Remove obsolete brief.' },
      tags: { value: [], explanation: 'Remove obsolete tags.' },
    },
  });
  await taskReviewService.accept('owner', { id, fields: ['themeId', 'category', 'brief', 'tags'] });
  expect(tx.task.updateMany).toHaveBeenCalledWith({
    where: { id: taskId, userId: 'owner' },
    data: {
      themeId: null,
      category: null,
      brief: null,
      tags: [],
    },
  });
});
it('rejects unavailable or cross-owner theme suggestions before writing', async () => {
  tx.taskReview.findFirst.mockResolvedValue({
    ...review(),
    document: {
      ...document,
      themeId: { value: '00000000-0000-4000-8000-000000000003', explanation: 'Suggested theme.' },
    },
  });
  tx.theme.findFirst.mockResolvedValue(null);
  await expect(
    taskReviewService.accept('owner', { id, fields: ['themeId'] })
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(tx.task.updateMany).not.toHaveBeenCalled();
});
it('reads saved v1 reviews while requiring new generations to supply the additional assessments', async () => {
  const legacy = Object.fromEntries(
    Object.entries(document).filter(
      ([key]) => !['themeId', 'category', 'brief', 'tags'].includes(key)
    )
  );
  expect(reviewDocumentSchema.safeParse(legacy).success).toBe(true);
  tx.taskReview.findFirst.mockResolvedValue({
    ...review(),
    document: legacy,
    promptVersion: 'task-review-v1',
  });
  expect(await taskReviewService.latest('owner', { taskId })).toMatchObject({ outdated: true });
});
