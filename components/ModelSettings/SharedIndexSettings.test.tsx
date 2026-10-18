jest.mock('@mantine/modals', () => ({ modals: { openConfirmModal: jest.fn() } }));
jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: jest.fn(),
    settings: { getAiModels: { useQuery: jest.fn() }, listAiModels: { useQuery: jest.fn() } },
    taskSearch: { status: { useQuery: jest.fn() }, rebuild: { useMutation: jest.fn() } },
    nutrition: {
      productIndexStatus: { useQuery: jest.fn() },
      rebuildProductIndex: { useMutation: jest.fn() },
    },
  },
}));
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { modals } from '@mantine/modals';
import { trpc } from '@/lib/trpc/client';
import { render } from '@/test-utils';
import { SharedIndexSettings } from './SharedIndexSettings';
const rebuild = jest.fn();
const status = {
  isFetchedAfterMount: true,
  error: null,
  data: {
    configuration: {
      modelId: 'old:latest',
      dimensions: 1024,
      queryPrefix: 'Instruct: Preserve my instruction\nQuery: ',
    },
    isMaintainer: true,
    indexed: 0,
    total: 0,
    busy: false,
    lastError: null,
  },
};
beforeEach(() => {
  jest.clearAllMocks();
  (trpc.useUtils as jest.Mock).mockReturnValue({});
  (trpc.taskSearch.status.useQuery as jest.Mock).mockReturnValue(status);
  (trpc.nutrition.productIndexStatus.useQuery as jest.Mock).mockReturnValue(status);
  (trpc.settings.listAiModels.useQuery as jest.Mock).mockReturnValue({
    data: [
      { id: 'old:latest', capabilities: ['embedding'] },
      { id: 'new:latest', capabilities: ['embedding'] },
    ],
  });
  (trpc.settings.getAiModels.useQuery as jest.Mock).mockReturnValue({
    isFetchedAfterMount: true,
    error: null,
    data: { settings: { embeddings: { provider: 'ollama', modelId: 'new:latest' } } },
  });
  (trpc.taskSearch.rebuild.useMutation as jest.Mock).mockReturnValue({ mutate: rebuild });
  (trpc.nutrition.rebuildProductIndex.useMutation as jest.Mock).mockReturnValue({
    mutate: jest.fn(),
  });
});
it('keeps published models pinned until a maintainer explicitly confirms a complete rebuild', async () => {
  const user = userEvent.setup();
  render(<SharedIndexSettings />);
  expect(screen.getByRole('combobox', { name: 'Planner · Task search model' })).toHaveValue(
    'old:latest'
  );
  expect(rebuild).not.toHaveBeenCalled();
  await user.click(
    screen.getAllByRole('button', { name: 'Use my Embeddings default (new:latest)' })[0]
  );
  expect(screen.getByRole('combobox', { name: 'Planner · Task search model' })).toHaveValue(
    'new:latest'
  );
  expect(rebuild).not.toHaveBeenCalled();
  await user.click(screen.getAllByRole('button', { name: 'Rebuild shared index' })[0]);
  expect(rebuild).not.toHaveBeenCalled();
  (modals.openConfirmModal as jest.Mock).mock.calls[0][0].onConfirm();
  expect(rebuild).toHaveBeenCalledWith({
    selection: { provider: 'ollama', modelId: 'new:latest' },
    queryInstruction: 'Preserve my instruction',
  });
});
it('shows ordinary users the published configuration without rebuild controls', () => {
  const data = { ...status, data: { ...status.data, isMaintainer: false } };
  (trpc.taskSearch.status.useQuery as jest.Mock).mockReturnValue(data);
  (trpc.nutrition.productIndexStatus.useQuery as jest.Mock).mockReturnValue(data);
  render(<SharedIndexSettings />);
  expect(screen.queryByRole('button', { name: 'Rebuild shared index' })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getAllByText(/old:latest · 1024 dimensions/)).toHaveLength(2);
});
