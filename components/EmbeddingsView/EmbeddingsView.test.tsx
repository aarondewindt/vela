jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    aiDev: {
      listEmbeddingModels: { useQuery: jest.fn() },
      generateEmbedding: { useMutation: jest.fn() },
      compareEmbeddings: { useMutation: jest.fn() },
    },
  },
}));

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { EmbeddingsView } from './EmbeddingsView';

const selection = { provider: 'ollama', modelId: 'embedding:first' };
const generate = {
  mutate: jest.fn(),
  reset: jest.fn(),
  isPending: false,
  error: null,
  data: undefined,
};
const compare = {
  mutate: jest.fn(),
  reset: jest.fn(),
  isPending: false,
  error: null,
  data: undefined,
};
const models = {
  isPending: false,
  isFetching: false,
  isSuccess: true,
  error: null,
  refetch: jest.fn(),
  data: [
    { provider: 'ollama', id: 'embedding:first', capabilities: ['embedding'] },
    { provider: 'ollama', id: 'embedding:second', capabilities: ['embedding'] },
  ],
};
const vector = { dimensions: 1024, preview: Array(16).fill(0.125) };

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = jest.fn();
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.releasePointerCapture = jest.fn();
  HTMLElement.prototype.scrollIntoView = jest.fn();
});
beforeEach(() => {
  jest.clearAllMocks();
  (trpc.aiDev.listEmbeddingModels.useQuery as jest.Mock).mockReturnValue(models);
  (trpc.aiDev.generateEmbedding.useMutation as jest.Mock).mockReturnValue(generate);
  (trpc.aiDev.compareEmbeddings.useMutation as jest.Mock).mockReturnValue(compare);
});
async function chooseModel(user: ReturnType<typeof userEvent.setup>, name = 'embedding:first') {
  await user.click(screen.getByRole('combobox', { name: 'Embedding model' }));
  await user.click(await screen.findByRole('option', { name }));
}

describe('EmbeddingsView', () => {
  it('requires explicit model selection and nonblank text', async () => {
    const user = userEvent.setup();
    render(<EmbeddingsView />);
    await user.type(screen.getByRole('textbox', { name: 'Text to embed' }), 'Hello');
    expect(screen.getByRole('button', { name: 'Generate embedding' })).toBeDisabled();
    await chooseModel(user);
    expect(screen.getByRole('button', { name: 'Generate embedding' })).toBeEnabled();
    await user.clear(screen.getByRole('textbox', { name: 'Text to embed' }));
    await user.type(screen.getByRole('textbox', { name: 'Text to embed' }), '   ');
    expect(screen.getByRole('button', { name: 'Generate embedding' })).toBeDisabled();
  });
  it('generates with exact text and the selected model', async () => {
    const user = userEvent.setup();
    render(<EmbeddingsView />);
    await chooseModel(user);
    await user.type(screen.getByRole('textbox', { name: 'Text to embed' }), ' Hello{Enter}');
    await user.click(screen.getByRole('button', { name: 'Generate embedding' }));
    expect(generate.mutate).toHaveBeenCalledWith({ selection, text: ' Hello\n' });
  });
  it('requires both comparison texts and uses a single model', async () => {
    const user = userEvent.setup();
    render(<EmbeddingsView />);
    await chooseModel(user);
    await user.type(screen.getByRole('textbox', { name: 'Text A' }), 'First');
    expect(screen.getByRole('button', { name: 'Compare texts' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Text B' }), 'Second');
    await user.click(screen.getByRole('button', { name: 'Compare texts' }));
    expect(compare.mutate).toHaveBeenCalledWith({ selection, textA: 'First', textB: 'Second' });
  });
  it('shows dimensions and a truncated vector preview', () => {
    (trpc.aiDev.generateEmbedding.useMutation as jest.Mock).mockReturnValue({
      ...generate,
      data: { selection, ...vector },
    });
    render(<EmbeddingsView />);
    const result = screen.getByRole('status', { name: 'Embedding result' });
    expect(within(result).getByText('1,024 dimensions')).toBeInTheDocument();
    expect(within(result).getByText(/first 16 of 1,024 values/)).toBeInTheDocument();
    expect(within(result).getByText(/0.125000, …/)).toBeInTheDocument();
    expect(within(result).getByText('ollama · embedding:first')).toBeInTheDocument();
  });
  it('shows a raw cosine score and both vector summaries', () => {
    (trpc.aiDev.compareEmbeddings.useMutation as jest.Mock).mockReturnValue({
      ...compare,
      data: { selection, similarity: -0.25, first: vector, second: vector },
    });
    render(<EmbeddingsView />);
    const result = screen.getByRole('status', { name: 'Comparison result' });
    expect(within(result).getByText('Cosine similarity: -0.250000')).toBeInTheDocument();
    expect(within(result).getByText('Text A · 1,024 dimensions')).toBeInTheDocument();
    expect(within(result).getByText('Text B · 1,024 dimensions')).toBeInTheDocument();
  });
  it.each(['generate', 'compare'])(
    'disables inputs and other submissions during %s',
    (operation) => {
      const hook =
        operation === 'generate'
          ? trpc.aiDev.generateEmbedding.useMutation
          : trpc.aiDev.compareEmbeddings.useMutation;
      (hook as jest.Mock).mockReturnValue({
        ...(operation === 'generate' ? generate : compare),
        isPending: true,
      });
      render(<EmbeddingsView />);
      expect(screen.getByRole('combobox', { name: 'Embedding model' })).toBeDisabled();
      expect(screen.getByRole('textbox', { name: 'Text to embed' })).toBeDisabled();
      expect(screen.getByRole('textbox', { name: 'Text A' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Compare texts' })).toBeDisabled();
      expect(
        screen.getByText(operation === 'generate' ? 'Generating embedding…' : 'Comparing texts…')
      ).toBeInTheDocument();
    }
  );
  it('clears both results on model change and the relevant result on text edits', async () => {
    const user = userEvent.setup();
    render(<EmbeddingsView />);
    await chooseModel(user);
    jest.clearAllMocks();
    await chooseModel(user, 'embedding:second');
    expect(generate.reset).toHaveBeenCalledTimes(1);
    expect(compare.reset).toHaveBeenCalledTimes(1);
    await user.type(screen.getByRole('textbox', { name: 'Text to embed' }), 'A');
    expect(generate.reset).toHaveBeenCalledTimes(2);
    await user.type(screen.getByRole('textbox', { name: 'Text B' }), 'B');
    expect(compare.reset).toHaveBeenCalledTimes(2);
  });
  it('reports missing models and offers discovery refresh', async () => {
    (trpc.aiDev.listEmbeddingModels.useQuery as jest.Mock).mockReturnValue({ ...models, data: [] });
    const user = userEvent.setup();
    render(<EmbeddingsView />);
    expect(screen.getByText(/No embedding models are installed/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh models' }));
    expect(models.refetch).toHaveBeenCalled();
  });
  it('shows discovery errors and prevents model selection', () => {
    (trpc.aiDev.listEmbeddingModels.useQuery as jest.Mock).mockReturnValue({
      ...models,
      error: new Error('Ollama is offline.'),
    });
    render(<EmbeddingsView />);
    expect(screen.getByText('Ollama is offline.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Embedding model' })).toBeDisabled();
  });
  it('shows operation errors without displaying stale results', () => {
    (trpc.aiDev.generateEmbedding.useMutation as jest.Mock).mockReturnValue({
      ...generate,
      error: new Error('Try shorter text.'),
      data: { selection, ...vector },
    });
    (trpc.aiDev.compareEmbeddings.useMutation as jest.Mock).mockReturnValue({
      ...compare,
      error: new Error('Check Ollama.'),
    });
    render(<EmbeddingsView />);
    expect(screen.getByText('Try shorter text.')).toBeInTheDocument();
    expect(screen.getByText('Check Ollama.')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Embedding result' })).not.toBeInTheDocument();
  });
});
