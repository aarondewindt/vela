/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    nutritionMealDraft: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    nutritionDraftTurn: { updateMany: jest.fn(), update: jest.fn(), create: jest.fn() },
    user: { findUniqueOrThrow: jest.fn() },
  },
}));
jest.mock('./products', () => ({ nutritionProducts: { get: jest.fn() } }));
jest.mock('./diary', () => ({ createNutritionLogEntry: jest.fn() }));
jest.mock('./draft-matching', () => ({ matchDraftItem: jest.fn(async (_owner, item) => item) }));
import { prisma } from '@/lib/prisma';
import type { NutritionMealDraft, NutritionDraftTurn } from '../../generated/prisma/client';
import { nutritionDrafts } from './drafts';
import { nutritionProducts } from './products';
import { createNutritionLogEntry } from './diary';
import { newDraftItem, withDraftProduct } from './draft-items';
import { productFixture } from './test-fixtures';
const id = '00000000-0000-4000-8000-000000000010';
const requestId = '00000000-0000-4000-8000-000000000011';
const date = new Date('2026-10-18T00:00:00Z');
let row: NutritionMealDraft & { turns: NutritionDraftTurn[] };
const resolved = () =>
  withDraftProduct({ ...newDraftItem('PB'), quantity: '30', unit: 'g' }, productFixture);
beforeEach(() => {
  jest.resetAllMocks();
  row = {
    id,
    userId: 'owner',
    title: 'Synthetic meal',
    logDate: date,
    mealCategory: 'LUNCH',
    provider: 'ollama',
    modelId: 'chat',
    status: 'DRAFT',
    revision: 1,
    items: [resolved()],
    questions: [],
    generationId: null,
    generationExpiresAt: null,
    confirmedEntryIds: [],
    confirmedAt: null,
    createdAt: date,
    updatedAt: date,
    turns: [],
  };
  (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(prisma));
  (prisma.nutritionMealDraft.findFirst as jest.Mock).mockImplementation(async () =>
    structuredClone(row)
  );
  (prisma.nutritionMealDraft.update as jest.Mock).mockImplementation(async ({ data }) => {
    const revision =
      typeof data.revision === 'object'
        ? row.revision + data.revision.increment
        : (data.revision ?? row.revision);
    row = { ...row, ...data, revision };
    return structuredClone(row);
  });
  (prisma.nutritionDraftTurn.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (prisma.nutritionMealDraft.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ timezone: 'Europe/Amsterdam' });
  (nutritionProducts.get as jest.Mock).mockResolvedValue(productFixture);
  (createNutritionLogEntry as jest.Mock).mockResolvedValue({ id: 'logged-entry' });
});
it('denies foreign/missing drafts and never exposes owner or generation tokens', async () => {
  const result = await nutritionDrafts.get('owner', id);
  expect(result).not.toHaveProperty('userId');
  expect(result).not.toHaveProperty('generationId');
  (prisma.nutritionMealDraft.findFirst as jest.Mock).mockResolvedValue(null);
  await expect(nutritionDrafts.get('foreign', id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(prisma.nutritionMealDraft.findFirst).toHaveBeenLastCalledWith(
    expect.objectContaining({ where: { id, userId: 'foreign' } })
  );
});
it('rejects stale manual edits before writes and uses only owned products', async () => {
  const item = resolved();
  row.items = [item];
  await expect(
    nutritionDrafts.edit('owner', { id, revision: 2, change: { type: 'remove', itemId: item.id } })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(prisma.nutritionMealDraft.update).not.toHaveBeenCalled();
  await nutritionDrafts.edit('owner', {
    id,
    revision: 1,
    change: {
      type: 'item',
      itemId: item.id,
      productId: productFixture.id,
      quantity: '60',
      unit: 'G',
    },
  });
  expect(nutritionProducts.get).toHaveBeenCalledWith('owner', productFixture.id, prisma);
});
it('manual edits supersede an active response and late completion cannot publish', async () => {
  row.generationId = requestId;
  row.generationExpiresAt = new Date(Date.now() + 60_000);
  const previous = await nutritionDrafts.get('owner', id);
  await nutritionDrafts.edit('owner', {
    id,
    revision: 1,
    change: { type: 'header', date: '2026-10-17', mealCategory: 'DINNER' },
  });
  expect(row.generationId).toBeNull();
  const writes = (prisma.nutritionMealDraft.update as jest.Mock).mock.calls.length;
  await expect(
    nutritionDrafts.finishTurn(
      'owner',
      { id, revision: 1, requestId, text: 'Old reply' },
      requestId,
      1,
      { reply: 'Changed', questions: [], operations: [] },
      { items: previous.items, date: previous.date, mealCategory: previous.mealCategory }
    )
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(prisma.nutritionMealDraft.update).toHaveBeenCalledTimes(writes);
});
it('recovers expired generation leases as failed without losing items', async () => {
  row.generationId = requestId;
  row.generationExpiresAt = new Date(Date.now() - 1000);
  const result = await nutritionDrafts.get('owner', id);
  expect(result.generating).toBe(false);
  expect(result.items).toHaveLength(1);
  expect(result.revision).toBe(2);
  expect(prisma.nutritionDraftTurn.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
  );
});
it('persists a turn and fences overlapping generation with the saved revision', async () => {
  const result = await nutritionDrafts.beginTurn('owner', {
    id,
    revision: 1,
    requestId,
    text: '200 grams of rice',
  });
  expect(result.generationId).toEqual(expect.any(String));
  expect(prisma.nutritionDraftTurn.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        id: requestId,
        status: 'GENERATING',
        userText: '200 grams of rice',
      }),
    })
  );
  await expect(
    nutritionDrafts.beginTurn('owner', {
      id,
      revision: 2,
      requestId: '00000000-0000-4000-8000-000000000099',
      text: 'Other',
    })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('replays completed requests and rejects a reused ID with different content', async () => {
  row.turns = [
    {
      id: requestId,
      draftId: id,
      userText: 'Original',
      assistantText: 'Done',
      status: 'COMPLETED',
      requestedRevision: 1,
      error: null,
      createdAt: date,
      updatedAt: date,
    },
  ];
  expect(
    await nutritionDrafts.beginTurn('owner', { id, revision: 1, requestId, text: 'Original' })
  ).toEqual({ generationId: null });
  await expect(
    nutritionDrafts.beginTurn('owner', { id, revision: 1, requestId, text: 'Different' })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(prisma.nutritionMealDraft.update).not.toHaveBeenCalled();
});
it('blocks empty/unresolved drafts, active generation and unacknowledged questions', async () => {
  row.items = [];
  await expect(
    nutritionDrafts.confirm('owner', { id, revision: 1, acknowledgeQuestions: false })
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  row.items = [newDraftItem('Unknown')];
  await expect(
    nutritionDrafts.confirm('owner', { id, revision: 1, acknowledgeQuestions: false })
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  row.items = [resolved()];
  row.questions = ['Check the date.'];
  await expect(
    nutritionDrafts.confirm('owner', { id, revision: 1, acknowledgeQuestions: false })
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  row.questions = [];
  row.generationId = requestId;
  row.generationExpiresAt = new Date(Date.now() + 60_000);
  await expect(
    nutritionDrafts.confirm('owner', { id, revision: 1, acknowledgeQuestions: false })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(createNutritionLogEntry).not.toHaveBeenCalled();
});
it('refreshes changed product references and requires a second explicit confirmation', async () => {
  (nutritionProducts.get as jest.Mock).mockResolvedValue({
    ...productFixture,
    version: 2,
    calories: '600',
  });
  const result = await nutritionDrafts.confirm('owner', {
    id,
    revision: 1,
    acknowledgeQuestions: false,
  });
  expect(result.confirmed).toBe(false);
  expect(row.revision).toBe(2);
  expect(createNutritionLogEntry).not.toHaveBeenCalled();
  const draft = await nutritionDrafts.get('owner', id);
  expect(draft.items[0].snapshot?.productVersion).toBe(2);
  expect(draft.totals.calories).toBe('180');
});
it('logs through the shared transaction and replays confirmation without inserting again', async () => {
  const result = await nutritionDrafts.confirm('owner', {
    id,
    revision: 1,
    acknowledgeQuestions: false,
  });
  expect(result).toMatchObject({ confirmed: true, date: '2026-10-18', entryIds: ['logged-entry'] });
  expect(createNutritionLogEntry).toHaveBeenCalledWith(
    prisma,
    'owner',
    expect.objectContaining({
      requestId: (row.items as any[])[0].id,
      productId: productFixture.id,
      productVersion: 1,
    })
  );
  expect(row.status).toBe('CONFIRMED');
  await nutritionDrafts.confirm('owner', { id, revision: 1, acknowledgeQuestions: false });
  expect(createNutritionLogEntry).toHaveBeenCalledTimes(1);
});
