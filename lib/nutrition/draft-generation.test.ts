/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/ai', () => ({ discoverModels: jest.fn(), generateStructured: jest.fn() }));
jest.mock('./drafts', () => ({
  nutritionDrafts: {
    beginTurn: jest.fn(),
    get: jest.fn(),
    finishTurn: jest.fn(),
    failTurn: jest.fn(),
  },
}));
import { generateStructured } from '@/lib/ai';
import { nutritionDrafts } from './drafts';
import { nutritionDraftGeneration } from './draft-generation';
const input = {
  id: '00000000-0000-4000-8000-000000000001',
  revision: 1,
  requestId: '00000000-0000-4000-8000-000000000002',
  text: 'Synthetic 200 grams of rice.',
};
beforeEach(() => {
  jest.resetAllMocks();
  (nutritionDrafts.beginTurn as jest.Mock).mockResolvedValue({
    generationId: 'lease',
    revision: 2,
    selection: { provider: 'ollama', modelId: 'chat' },
    timezone: 'Europe/Amsterdam',
    today: '2026-10-18',
    history: [],
    current: { date: '2026-10-16', mealCategory: 'LUNCH', items: [] },
  });
});
it('supplies authoritative date/timezone and current stable item state to shared generation', async () => {
  const result = { reply: 'Done', questions: [], operations: [] };
  (generateStructured as jest.Mock).mockResolvedValue(result);
  await nutritionDraftGeneration.interpret('owner', input);
  const args = (generateStructured as jest.Mock).mock.calls[0][0];
  expect(JSON.parse(args.prompt)).toMatchObject({
    today: '2026-10-18',
    yesterday: '2026-10-17',
    timezone: 'Europe/Amsterdam',
    current: { date: '2026-10-16' },
  });
  expect(nutritionDrafts.finishTurn).toHaveBeenCalledWith(
    'owner',
    input,
    'lease',
    2,
    result,
    expect.any(Object),
    expect.any(AbortSignal)
  );
});
it('replays completed messages without another model call', async () => {
  (nutritionDrafts.beginTurn as jest.Mock).mockResolvedValue({ generationId: null });
  await nutritionDraftGeneration.interpret('owner', input);
  expect(generateStructured).not.toHaveBeenCalled();
  expect(nutritionDrafts.get).toHaveBeenCalledWith('owner', input.id);
});
it('preserves the draft and records a recoverable failure on invalid/model output', async () => {
  (generateStructured as jest.Mock).mockRejectedValue(new Error('Structured response failed'));
  await expect(nutritionDraftGeneration.interpret('owner', input)).rejects.toThrow(
    'Structured response failed'
  );
  expect(nutritionDrafts.failTurn).toHaveBeenCalledWith(
    'owner',
    input.id,
    input.requestId,
    'lease'
  );
  expect(nutritionDrafts.finishTurn).not.toHaveBeenCalled();
});
