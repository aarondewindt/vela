import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { ProposalWorkspace } from './PlanningProposals';
import type { GenerationReport } from '@/lib/planner/proposals/schema';

jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: jest.fn(),
    planningProposals: {
      replan: { useMutation: jest.fn() },
      generate: { useMutation: jest.fn() },
      context: { useQuery: jest.fn() },
      list: { useQuery: jest.fn() },
      get: { useQuery: jest.fn() },
      createEdit: { useMutation: jest.fn() },
      accept: { useMutation: jest.fn() },
      discard: { useMutation: jest.fn() },
    },
  },
}));
import { trpc } from '@/lib/trpc/client';

const create = jest.fn();
const generate = jest.fn();
const accept = jest.fn();
const discard = jest.fn();
const reset = jest.fn();
const id = '00000000-0000-4000-8000-000000000001';
const candidateId = 'task:new';
let invalidReason: string | null;
let status: string;
const date = '2030-01-07';
const preview = {
  generation: undefined as GenerationReport | undefined,
  changes: [
    {
      type: 'add',
      explanation: 'Morning focus',
      before: null,
      after: {
        id: 'new:0',
        title: 'Fixture task',
        startsAt: `${date}T09:00:00Z`,
        endsAt: `${date}T09:30:00Z`,
        durationMinutes: 30,
      },
    },
  ],
  warnings: [],
  remaining: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  invalidReason = null;
  status = 'PENDING';
  preview.generation = undefined;
  const invalidate = jest.fn().mockResolvedValue(undefined);
  (trpc.useUtils as jest.Mock).mockReturnValue({
    planningProposals: { invalidate, list: { invalidate } },
    planner: { getDayData: { invalidate }, getPlan: { invalidate }, listTasks: { invalidate } },
  });
  (trpc.planningProposals.context.useQuery as jest.Mock).mockReturnValue({
    isFetchedAfterMount: true,
    data: {
      baseHash: 'a'.repeat(64),
      timezone: 'Europe/Amsterdam',
      blocks: [],
      candidates: [{ id: candidateId, title: 'Fixture task' }],
    },
  });
  (trpc.planningProposals.list.useQuery as jest.Mock).mockReturnValue({
    data: [{ id, status: 'PENDING', createdAt: new Date(`${date}T08:00:00Z`) }],
  });
  (trpc.planningProposals.get.useQuery as jest.Mock).mockImplementation(({ id: selected }) => ({
    data: selected
      ? { id, date, timezone: 'Europe/Amsterdam', status, invalidReason, preview, receipt: null }
      : undefined,
  }));
  (trpc.planningProposals.createEdit.useMutation as jest.Mock).mockReturnValue({
    mutate: create,
    reset,
  });
  (trpc.planningProposals.replan.useMutation as jest.Mock).mockReturnValue({
    mutate: jest.fn(),
    reset,
  });
  (trpc.planningProposals.generate.useMutation as jest.Mock).mockReturnValue({
    mutate: generate,
    reset,
  });
  (trpc.planningProposals.accept.useMutation as jest.Mock).mockReturnValue({
    mutate: accept,
    reset,
  });
  (trpc.planningProposals.discard.useMutation as jest.Mock).mockReturnValue({
    mutate: discard,
    reset,
  });
  Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => id });
});

function generationFixture(): GenerationReport {
  return {
    requestHash: 'a'.repeat(64),
    mode: 'deterministic',
    model: null,
    guidance: '',
    summary: 'Planned 30 task minutes across 1 task. 0 task minutes remain unscheduled.',
    reviewBy: `${date}T09:00:00.000Z`,
    warnings: [],
    outcomes: [],
  };
}

it('shows the apply deadline and blocks an expired preview with an explicit regeneration action', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(`${date}T09:01:00Z`));
  try {
    preview.generation = generationFixture();
    render(<ProposalWorkspace date={date} />);
    await selectProposal();
    expect(screen.getByText(/Apply before/)).toHaveTextContent('Europe/Amsterdam');
    expect(screen.getByText(/preview’s start time has passed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Generate fresh preview' }));
    expect(generate).toHaveBeenCalledWith({
      date,
      requestId: id,
      mode: 'deterministic',
      guidance: '',
    });
    expect(accept).not.toHaveBeenCalled();
  } finally {
    now.mockRestore();
  }
});

it('keeps model intent separate from the actual placement report', async () => {
  preview.generation = {
    ...generationFixture(),
    reviewBy: undefined,
    selectionSummary: 'Selection intent only',
    model: { provider: 'ollama', modelId: 'fixture' },
    mode: 'ai',
  };
  render(<ProposalWorkspace date={date} />);
  await selectProposal();
  expect(screen.getByText(preview.generation.summary)).toBeVisible();
  expect(screen.getByText('Selection intent only')).not.toBeVisible();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'AI assessment before scheduling' }));
  await waitFor(() => expect(screen.getByText('Selection intent only')).toBeVisible());
});

it('makes the fill goal and actual availability windows visible in the preview', async () => {
  preview.generation = {
    ...generationFixture(),
    reviewBy: undefined,
    planningGoal: 'fill',
    workBudgetMinutes: null,
    availableWindows: [{ startsAt: `${date}T08:00:00Z`, endsAt: `${date}T08:45:00Z` }],
    additionalCandidateCount: 20,
  };
  render(<ProposalWorkspace date={date} />);
  await selectProposal();
  expect(screen.getByText('Planning goal: Fill eligible available time')).toBeVisible();
  expect(screen.getByText('Availability windows (Europe/Amsterdam)')).toBeVisible();
  expect(screen.getByText(/20 additional eligible candidates considered/)).toBeVisible();
});
async function selectProposal() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Saved proposals' }));
  await user.click(screen.getByRole('option', { name: /PENDING/ }));
}
it('generates a reviewable plan with guidance and an explicit deterministic option', async () => {
  render(<ProposalWorkspace date={date} />);
  const user = userEvent.setup();
  fireEvent.change(screen.getByLabelText('Planning guidance'), {
    target: { value: 'Keep today light' },
  });
  await user.click(screen.getByRole('button', { name: 'Generate plan preview' }));
  expect(generate).toHaveBeenCalledWith({
    date,
    requestId: id,
    mode: 'ai',
    guidance: 'Keep today light',
  });
  expect(accept).not.toHaveBeenCalled();
  await user.click(screen.getByRole('combobox', { name: 'Planning method' }));
  await user.click(screen.getByRole('option', { name: 'Deterministic · urgency order' }));
  await user.click(screen.getByRole('button', { name: 'Generate plan preview' }));
  expect(generate).toHaveBeenLastCalledWith({
    date,
    requestId: id,
    mode: 'deterministic',
    guidance: '',
  });
  expect(screen.getByLabelText('Planning guidance')).toBeDisabled();
});
it('creates a preview without applying changes', async () => {
  render(<ProposalWorkspace date={date} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Manual plan change' }));
  await user.click(await screen.findByRole('combobox', { name: 'Task' }));
  await user.click(screen.getByRole('option', { name: 'Fixture task' }));
  fireEvent.change(screen.getByLabelText('Reason for this change'), {
    target: { value: 'Morning focus' },
  });
  await user.click(screen.getByRole('button', { name: 'Preview change' }));
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      date,
      baseHash: 'a'.repeat(64),
      requestId: id,
      candidateId,
      explanation: 'Morning focus',
    })
  );
  expect(accept).not.toHaveBeenCalled();
});
it('shows the preview and applies only on explicit acceptance', async () => {
  render(<ProposalWorkspace date={date} />);
  await selectProposal();
  expect(screen.getByText(/After: Fixture task/)).toBeInTheDocument();
  expect(accept).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(accept).toHaveBeenCalledWith({ id });
});
it('blocks stale proposals while permitting discard', async () => {
  invalidReason = 'Planning inputs changed. Create a fresh proposal.';
  render(<ProposalWorkspace date={date} />);
  await selectProposal();
  expect(screen.getByText(invalidReason)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Discard proposal' }));
  expect(discard).toHaveBeenCalledWith({ id });
  expect(accept).not.toHaveBeenCalled();
});
it('does not offer apply or discard for an applied proposal', async () => {
  status = 'APPLIED';
  render(<ProposalWorkspace date={date} />);
  await selectProposal();
  expect(screen.getByText('APPLIED')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Apply changes' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Discard proposal' })).not.toBeInTheDocument();
});
