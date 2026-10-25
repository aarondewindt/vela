import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { PlannerConversation, RecordReview } from './PlannerConversation';
jest.mock('@/components/PlanningProposals/PlanningProposals', () => ({
  ProposalWorkspace: ({ initialProposalId }: { initialProposalId: string }) => (
    <div>Plan preview {initialProposalId}</div>
  ),
}));
jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: jest.fn(),
    aiDev: { listChatModels: { useQuery: jest.fn() } },
    settings: { getAiModels: { useQuery: jest.fn() }, getPreferences: { useQuery: jest.fn() } },
    plannerConversation: {
      list: { useQuery: jest.fn() },
      get: { useQuery: jest.fn() },
      create: { useMutation: jest.fn() },
      changeModel: { useMutation: jest.fn() },
      send: { useMutation: jest.fn() },
      accept: { useMutation: jest.fn() },
      discard: { useMutation: jest.fn() },
    },
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
  (trpc.plannerConversation.changeModel.useMutation as jest.Mock).mockReturnValue({
    mutate: jest.fn(),
  });
});

const preview = {
  entity: 'task' as const,
  action: 'delete' as const,
  id: 'id',
  baseHash: 'hash',
  before: { title: 'Report', status: 'BACKLOG' },
  patch: {},
  warnings: ['Deleting occurrences cannot be undone.'],
};
it('shows the resolved record and requires an explicit checkbox before deletion', async () => {
  const user = userEvent.setup();
  const accept = jest.fn();
  render(<RecordReview preview={preview} accepted={false} active busy={false} accept={accept} />);
  expect(screen.getByText('delete task: Report')).toBeVisible();
  expect(screen.getByText(preview.warnings[0])).toBeVisible();
  expect(screen.getByRole('button', { name: 'Confirm deletion' })).toBeDisabled();
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  expect(accept).toHaveBeenCalledWith(true);
});
it('shows before/after changes and omits acceptance for superseded previews', () => {
  render(
    <RecordReview
      preview={{ ...preview, action: 'update', patch: { title: 'Revised report' } }}
      accepted={false}
      active={false}
      busy={false}
      accept={jest.fn()}
    />
  );
  expect(screen.getByText('Title: Report → Revised report')).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('shows acceptance receipts instead of another acceptance action', () => {
  render(
    <RecordReview
      preview={{ ...preview, action: 'create', before: null, patch: { title: 'Report' } }}
      accepted
      active={false}
      busy={false}
      accept={jest.fn()}
    />
  );
  expect(screen.getByRole('status')).toHaveTextContent('Changes accepted.');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('retries the same message with its original request ID and revision after a network failure', async () => {
  const user = userEvent.setup();
  const conversationId = '00000000-0000-4000-8000-000000000001';
  const mutate = jest.fn();
  const query = { data: { id: conversationId, revision: 0, busy: false, turns: [] } };
  (trpc.useUtils as jest.Mock).mockReturnValue({});
  (trpc.settings.getPreferences.useQuery as jest.Mock).mockReturnValue({
    data: { timezone: 'Pacific/Auckland' },
  });
  (trpc.plannerConversation.list.useQuery as jest.Mock).mockReturnValue({
    data: [{ id: conversationId, updatedAt: new Date() }],
  });
  (trpc.plannerConversation.get.useQuery as jest.Mock).mockReturnValue(query);
  (trpc.plannerConversation.send.useMutation as jest.Mock).mockReturnValue({
    mutate,
    reset: jest.fn(),
  });
  for (const name of ['create', 'accept', 'discard'] as const) {
    (trpc.plannerConversation[name].useMutation as jest.Mock).mockReturnValue({
      mutate: jest.fn(),
      reset: jest.fn(),
    });
  }
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
  });
  render(<PlannerConversation />);
  await user.click(screen.getByRole('combobox', { name: 'Saved conversations' }));
  await user.click(screen.getByRole('option'));
  fireEvent.change(screen.getByLabelText('Message'), {
    target: { value: 'Create a task called Report' },
  });
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  query.data.revision = 1;
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  expect(mutate).toHaveBeenCalledTimes(2);
  expect(mutate.mock.calls[1][0]).toEqual(mutate.mock.calls[0][0]);
  expect(mutate.mock.calls[0][0]).toMatchObject({
    conversationId,
    revision: 0,
    text: 'Create a task called Report',
  });
});
it('shows readable field labels and resolved relationship names', () => {
  render(
    <RecordReview
      preview={{
        ...preview,
        action: 'update',
        before: { title: 'Report', themeId: null },
        patch: { themeId: 'theme-id', estimatedMinutes: 45 },
        references: { 'theme-id': 'Home projects' },
      }}
      accepted={false}
      active
      busy={false}
      accept={jest.fn()}
    />
  );
  expect(screen.getByText('Theme: Clear / inherit → Home projects')).toBeVisible();
  expect(screen.getByText('Estimate (minutes): Clear / inherit → 45')).toBeVisible();
});

it('changes the saved conversation model from the composer and locks it during a reply', async () => {
  const user = userEvent.setup();
  const conversationId = '00000000-0000-4000-8000-000000000001';
  const mutate = jest.fn();
  const query = {
    data: {
      id: conversationId,
      revision: 3,
      busy: false,
      turns: [],
      override: { provider: 'ollama', modelId: 'chat' },
    },
  };
  (trpc.useUtils as jest.Mock).mockReturnValue({});
  (trpc.settings.getPreferences.useQuery as jest.Mock).mockReturnValue({
    data: { timezone: 'Europe/Amsterdam' },
  });
  (trpc.plannerConversation.list.useQuery as jest.Mock).mockReturnValue({
    data: [{ id: conversationId, updatedAt: new Date() }],
  });
  (trpc.plannerConversation.get.useQuery as jest.Mock).mockReturnValue(query);
  (trpc.plannerConversation.changeModel.useMutation as jest.Mock).mockReturnValue({ mutate });
  for (const name of ['create', 'send', 'accept', 'discard'] as const) {
    (trpc.plannerConversation[name].useMutation as jest.Mock).mockReturnValue({
      mutate: jest.fn(),
      reset: jest.fn(),
    });
  }
  const view = render(<PlannerConversation />);
  await user.click(screen.getByRole('combobox', { name: 'Saved conversations' }));
  await user.click(screen.getByRole('option'));
  await user.click(screen.getByRole('button', { name: 'Chat model' }));
  await user.click(screen.getByRole('option', { name: /Use default/ }));
  expect(mutate).toHaveBeenCalledWith({ conversationId, revision: 3, selection: null });
  query.data.busy = true;
  view.rerender(
    <>
      <PlannerConversation />
    </>
  );
  expect(screen.getByRole('button', { name: 'Chat model' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
});
