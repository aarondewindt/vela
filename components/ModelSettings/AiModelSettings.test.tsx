jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: jest.fn(),
    settings: {
      getAiModels: { useQuery: jest.fn() },
      listAiModels: { useQuery: jest.fn() },
      updateAiModel: { useMutation: jest.fn() },
    },
  },
}));
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { AiModelSettings } from './AiModelSettings';
const mutate = jest.fn();
const query = { isFetchedAfterMount: true, error: null, data: { settings: {}, resolved: {} } };
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = jest.fn();
});
beforeEach(() => {
  jest.clearAllMocks();
  (trpc.useUtils as jest.Mock).mockReturnValue({});
  (trpc.settings.getAiModels.useQuery as jest.Mock).mockReturnValue(query);
  (trpc.settings.listAiModels.useQuery as jest.Mock).mockReturnValue({
    data: [
      { id: 'text:latest', capabilities: ['chat'] },
      { id: 'gemma3:12b', capabilities: ['chat', 'vision'] },
      { id: 'embed:latest', capabilities: ['embedding'] },
    ],
    error: null,
  });
  (trpc.settings.updateAiModel.useMutation as jest.Mock).mockReturnValue({
    mutate,
    isPending: false,
    error: null,
  });
});
it('offers only compatible vision-language models and saves the account preference', async () => {
  const user = userEvent.setup();
  render(<AiModelSettings />);
  await user.click(screen.getByRole('combobox', { name: 'Vision language' }));
  expect(screen.queryByRole('option', { name: 'text:latest' })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'embed:latest' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('option', { name: 'gemma3:12b' }));
  expect(mutate).toHaveBeenCalledWith({
    key: 'visionLanguage',
    value: { provider: 'ollama', modelId: 'gemma3:12b' },
  });
});
it('allows a feature to follow a profile and clear its override back to inheritance', async () => {
  (trpc.settings.getAiModels.useQuery as jest.Mock).mockReturnValue({
    ...query,
    data: { settings: { default: { provider: 'ollama', modelId: 'text:latest' } }, resolved: {} },
  });
  const user = userEvent.setup();
  render(<AiModelSettings />);
  await user.click(screen.getByRole('combobox', { name: 'Nutrition · Describe a meal' }));
  await user.click(screen.getByRole('option', { name: 'Use Fast default' }));
  expect(mutate).toHaveBeenCalledWith({ key: 'nutrition.mealDraft', value: { profile: 'fast' } });
  await user.click(screen.getByRole('combobox', { name: 'Default LLM' }));
  await user.click(screen.getByRole('option', { name: 'Not configured' }));
  expect(mutate).toHaveBeenLastCalledWith({ key: 'default', value: null });
});
it('keeps an unavailable configured model visible and hides cached settings before authorization', () => {
  (trpc.settings.getAiModels.useQuery as jest.Mock).mockReturnValue({
    ...query,
    data: {
      settings: { default: { provider: 'ollama', modelId: 'removed:latest' } },
      resolved: {},
    },
  });
  const view = render(<AiModelSettings />);
  expect(screen.getByRole('combobox', { name: 'Default LLM' })).toHaveValue(
    'removed:latest (unavailable)'
  );
  (trpc.settings.getAiModels.useQuery as jest.Mock).mockReturnValue({
    ...query,
    isFetchedAfterMount: false,
  });
  view.rerender(<AiModelSettings />);
  expect(screen.getByRole('combobox', { name: 'Default LLM' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Default LLM' })).toHaveValue('Not configured');
});
