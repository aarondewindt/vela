import userEvent from '@testing-library/user-event';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { PlanReview } from './PlanReview';

jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: jest.fn(),
    settings: { getAiModels: { useQuery: jest.fn() } },
    aiDev: { listChatModels: { useQuery: jest.fn() } },
    planningProposals: { review: { useMutation: jest.fn() }, create: { useMutation: jest.fn() } },
  },
}));
import { trpc } from '@/lib/trpc/client';
beforeEach(() => {
  (trpc.settings.getAiModels.useQuery as jest.Mock).mockReturnValue({
    isFetchedAfterMount: true,
    error: null,
    data: {
      resolved: Object.fromEntries(
        ['planner.dayPlan', 'planner.planReview', 'planner.conversation'].map((feature) => [
          feature,
          { selection: { provider: 'ollama', modelId: 'chat' }, source: 'Default LLM' },
        ])
      ),
    },
  });
  (trpc.aiDev.listChatModels.useQuery as jest.Mock).mockReturnValue({
    data: [{ provider: 'ollama', id: 'chat', capabilities: ['chat'] }],
  });
});

const review = jest.fn();
const create = jest.fn();
const reset = jest.fn();
const document = {
  schemaVersion: 1 as const,
  operations: [{ type: 'remove' as const, blockId: 'block', explanation: 'Release work' }],
};
const result = {
  date: '2030-01-07',
  baseHash: 'a'.repeat(64),
  reviewedAt: '2030-01-07T08:00:00Z',
  timezone: 'UTC',
  mode: 'ai',
  model: null,
  aiError: null,
  conflicts: [{ code: 'OVERLAP', blockIds: ['block'], explanation: 'Verified overlap' }],
  concerns: [
    { code: 'AI_CONTEXT', blockIds: ['block'], explanation: 'May be too much context switching' },
  ],
  blocks: [{ id: 'block', title: 'Work task' }],
  warnings: [],
  corrections: [
    {
      blockId: 'block',
      title: 'Release Work task',
      explanation: 'Release work',
      document,
      displaced: {
        title: 'Work task',
        minutes: 30,
        due: '2030-01-07T12:00:00Z',
        deadlineRisk: true,
      },
      replacement: null,
    },
  ],
};
beforeEach(() => {
  jest.clearAllMocks();
  (trpc.useUtils as jest.Mock).mockReturnValue({
    planningProposals: { list: { invalidate: jest.fn() } },
  });
  (trpc.planningProposals.review.useMutation as jest.Mock).mockReturnValue({
    mutate: review,
    reset,
  });
  (trpc.planningProposals.create.useMutation as jest.Mock).mockReturnValue({
    mutate: create,
    reset,
  });
});
it('requests a verified review without any plan mutation', () => {
  render(<PlanReview date="2030-01-07" onCreated={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review day plan' }));
  expect(review).toHaveBeenCalledWith({ date: '2030-01-07', mode: 'deterministic', guidance: '' });
  expect(create).not.toHaveBeenCalled();
});
it('separates verified and advisory findings, explains displaced deadlines and only creates a preview', () => {
  (trpc.planningProposals.review.useMutation as jest.Mock).mockReturnValue({
    mutate: review,
    reset,
    data: result,
  });
  render(<PlanReview date="2030-01-07" onCreated={jest.fn()} />);
  expect(screen.getByText('Verified overlap')).toBeInTheDocument();
  expect(screen.getByText('AI concerns · advisory')).toBeInTheDocument();
  expect(screen.getByText('May be too much context switching')).toBeInTheDocument();
  expect(screen.getByText(/30 minutes released.*deferral risks the deadline/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Preview correction' }));
  expect(create).toHaveBeenCalledWith({
    requestId: expect.any(String),
    date: '2030-01-07',
    baseHash: result.baseHash,
    document,
  });
  expect(screen.queryByRole('button', { name: 'Apply changes' })).not.toBeInTheDocument();
});
it('preserves verified results when AI is unavailable and shows stale correction failures', () => {
  (trpc.planningProposals.review.useMutation as jest.Mock).mockReturnValue({
    mutate: review,
    reset,
    data: { ...result, concerns: [], aiError: 'Model unavailable' },
  });
  (trpc.planningProposals.create.useMutation as jest.Mock).mockReturnValue({
    mutate: create,
    reset,
    error: { message: 'Planning inputs changed. Review again.' },
  });
  render(<PlanReview date="2030-01-07" onCreated={jest.fn()} />);
  expect(screen.getByText(/AI review unavailable/)).toBeInTheDocument();
  expect(screen.getByText('Verified overlap')).toBeInTheDocument();
  expect(screen.getByText('Planning inputs changed. Review again.')).toBeInTheDocument();
});

beforeAll(() => {
  Object.defineProperty(window.document, 'fonts', {
    configurable: true,
    value: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
  });
});

it('reviews with empty AI guidance and the selected model', async () => {
  const user = userEvent.setup();
  render(<PlanReview date="2030-01-07" onCreated={jest.fn()} />);
  await user.click(screen.getByRole('combobox', { name: 'Review method' }));
  await user.click(screen.getByRole('option', { name: 'Verified conflicts and AI concerns' }));
  await user.click(screen.getByRole('button', { name: 'Chat model' }));
  await user.click(screen.getByRole('option', { name: 'chat Default' }));
  await user.click(screen.getByRole('button', { name: 'Review day plan' }));
  expect(review).toHaveBeenCalledWith({
    date: '2030-01-07',
    mode: 'ai',
    guidance: '',
    selection: { provider: 'ollama', modelId: 'chat' },
  });
});
