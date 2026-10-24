/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('./tools', () => ({ planningTools: jest.fn(() => ({ generateDayPlan: {} })) }));
jest.mock('@/lib/ai-dev/conversations', () => ({
  createConversationService: jest.fn(() => ({ get: jest.fn() })),
}));
jest.mock('@/lib/ai-dev/service', () => ({
  createChatService: jest.fn(() => ({ streamChat: jest.fn() })),
}));
jest.mock('../proposals/service', () => ({ proposalService: { context: jest.fn() } }));
jest.mock('../service', () => ({ plannerService: { getDayData: jest.fn() } }));

import { createChatService } from '@/lib/ai-dev/service';
import { proposalService } from '../proposals/service';
import { plannerService } from '../service';
import { plannerChatContext, plannerChatConversations, streamPlannerChat } from './service';
import { plannerChatInputSchema } from './schema';

const chatStream = (createChatService as jest.Mock).mock.results[0].value.streamChat;

const input = {
  conversationId: '45f6af99-9a30-4638-b05f-fb826b970379',
  date: '2026-10-24',
  message: { id: 'u', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Help' }] },
};
beforeEach(() => {
  jest.clearAllMocks();
  (plannerChatConversations.get as jest.Mock).mockResolvedValue({});
  (proposalService.context as jest.Mock).mockResolvedValue({
    timezone: 'Europe/Amsterdam',
    blocks: Array.from({ length: 81 }, (_, id) => ({ id, title: 'B'.repeat(300) })),
    candidates: Array.from({ length: 45 }, (_, id) => ({ id, title: 'T'.repeat(300) })),
  });
  (plannerService.getDayData as jest.Mock).mockResolvedValue({
    availability: [{ start: '09:00', end: '17:00' }],
    privateExtra: 'never send',
  });
});
it('loads owner-scoped day context and bounds the records and titles sent to the model', async () => {
  const result = await plannerChatContext('owner', input.date);
  expect(proposalService.context).toHaveBeenCalledWith('owner', input.date);
  expect(plannerService.getDayData).toHaveBeenCalledWith('owner', input.date);
  expect(result.blocks).toHaveLength(80);
  expect(result.candidates).toHaveLength(40);
  expect(result.candidates[0].title).toHaveLength(240);
  expect(result).toMatchObject({
    omittedBlocks: 1,
    omittedCandidates: 5,
    timezone: 'Europe/Amsterdam',
  });
  expect(JSON.stringify(result)).not.toContain('never send');
});
it('authorizes the conversation before loading context or starting inference', async () => {
  (plannerChatConversations.get as jest.Mock).mockRejectedValue(new Error('Not found'));
  await expect(streamPlannerChat('other', input, new AbortController().signal)).rejects.toThrow(
    'Not found'
  );
  expect(proposalService.context).not.toHaveBeenCalled();
  expect(chatStream).not.toHaveBeenCalled();
});
it('reuses streaming with typed orchestration instructions and authoritative date', async () => {
  const signal = new AbortController().signal;
  await streamPlannerChat('owner', input, signal);
  const stream = chatStream;
  expect(stream).toHaveBeenCalledWith(
    'owner',
    input,
    signal,
    expect.stringContaining('existing AI scheduler'),
    expect.objectContaining({ generateDayPlan: {} })
  );
  expect(stream.mock.calls[0][3]).toContain('2026-10-24');
});
it('requires a valid calendar date and text-only user message', () => {
  expect(plannerChatInputSchema.safeParse(input).success).toBe(true);
  expect(plannerChatInputSchema.safeParse({ ...input, date: '2026-02-30' }).success).toBe(false);
  expect(
    plannerChatInputSchema.safeParse({ ...input, message: { ...input.message, role: 'system' } })
      .success
  ).toBe(false);
});
it('verifies explicit workspace proposal references against owner and selected date before inference', async () => {
  const get = jest.fn().mockRejectedValue(new Error('Not found'));
  Object.assign(proposalService, { get });
  await expect(
    streamPlannerChat(
      'other',
      { ...input, proposalId: input.conversationId },
      new AbortController().signal
    )
  ).rejects.toThrow('Not found');
  expect(get).toHaveBeenCalledWith('other', input.conversationId);
  expect(chatStream).not.toHaveBeenCalled();
});
it('rejects oversized Planner messages rather than silently losing hard constraints during truncation', () => {
  expect(
    plannerChatInputSchema.safeParse({
      ...input,
      message: { ...input.message, parts: [{ type: 'text', text: 'x'.repeat(2001) }] },
    }).success
  ).toBe(false);
});
