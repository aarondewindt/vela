import { createClientId } from '@/lib/client-id';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { ProductEditor } from './ProductEditor';
import { productSuggestionSchema, nutrientNames } from '@/lib/nutrition/product-extraction/schema';
import { dutchMilk } from '@/lib/nutrition/product-extraction/fixtures';
import { productFixture } from '@/lib/nutrition/test-fixtures';
import type { ModelSelection } from '@/lib/model-settings/schema';

const selection = { provider: 'ollama', modelId: 'fixture-vision' };
const textSelection = { provider: 'ollama', modelId: 'fixture-text' };
let stageOverrides: Record<'transcription' | 'interpretation', ModelSelection | null>;
let messages: unknown[];
let productId: string | null;
let failExtraction: boolean;
let extractionFailureMessage: string;
let failLink: boolean;
let serverGenerating: boolean;
let cachedGenerating: boolean;
let queriedConversationId: string | null;
const invalidateHistory = jest.fn(async () => {
  cachedGenerating = serverGenerating;
});
const refreshHistory = jest.fn(async () => {
  cachedGenerating = serverGenerating;
  return {};
});
const extract = jest.fn(async ({ message }) => {
  if (failExtraction) {
    throw new Error(extractionFailureMessage);
  }
  messages = [
    ...messages,
    message,
    {
      id: createClientId(),
      role: 'assistant',
      parts: [
        {
          type: 'data-productSuggestion',
          data: productSuggestionSchema.parse({
            version: 1,
            evidence: dutchMilk(),
            warnings: ['fiber: missing'],
            product: {
              name: 'Halfvolle melk',
              brand: 'Jumbo',
              referenceQuantity: '100',
              referenceUnit: 'ML',
              calories: '47',
              protein: '3.5',
              carbohydrates: '4.7',
              fat: '1.5',
            },
            nutrition: Object.fromEntries(
              nutrientNames.map((key) => [
                key,
                {
                  value: key === 'fiber' ? null : '0',
                  status: key === 'fiber' ? 'missing' : 'printed',
                  note: 'Fixture label',
                },
              ])
            ),
          }),
        },
      ],
    },
  ];
});
const link = jest.fn(async () => {
  if (failLink) {
    throw new Error('Link unavailable');
  }
});
const create = jest.fn(async (input) => ({ ...productFixture, ...input, id: productFixture.id }));
const update = jest.fn(async (input) => ({ ...productFixture, ...input.product }));
const createConversation = jest.fn(async (input) => {
  stageOverrides = { ...input.stageOverrides };
  return { id: 'draft' };
});
const changeStageModel = jest.fn(async ({ stage, selection }) => {
  stageOverrides = { ...stageOverrides, [stage]: selection };
});
const mutation = (fn: unknown) => ({ mutateAsync: fn, isPending: false, error: null });
const query = (data: unknown) => ({ data, error: null, refetch: jest.fn(async () => ({})) });
jest.mock('@/components/ModelSettings/FeatureModelSelect', () => ({
  useFeatureModel: (feature: string, override: ModelSelection | null) => {
    const inherited = feature === 'nutrition.productInterpretation' ? textSelection : selection;
    return {
      selection: override ?? inherited,
      source: override ? 'Chat override' : 'Feature default',
      defaultSelection: inherited,
      defaultSource: 'Feature default',
      defaultLoading: false,
      defaultError: null,
      loading: false,
      error: null,
    };
  },
}));
jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      nutrition: { productChat: { getConversation: { invalidate: invalidateHistory } } },
    }),
    nutrition: {
      createProduct: { useMutation: () => mutation(create) },
      updateProduct: { useMutation: () => mutation(update) },
      autofillRecipe: { useMutation: () => mutation(jest.fn()) },
      productChat: {
        listConversations: {
          useQuery: () => query([{ id: 'draft', title: 'Draft milk', productId: null }]),
        },
        listForProduct: {
          useQuery: () => query(productId ? [{ id: 'draft', title: 'Milk history' }] : []),
        },
        getConversation: {
          useQuery: ({ id }: { id: string }) => {
            if (id && queriedConversationId !== id) {
              queriedConversationId = id;
              cachedGenerating = serverGenerating;
            }
            return {
              ...query(
                id
                  ? {
                      messages,
                      productId,
                      override: stageOverrides.transcription,
                      stageOverrides,
                      generating: cachedGenerating,
                    }
                  : undefined
              ),
              refetch: refreshHistory,
            };
          },
        },
        createConversation: { useMutation: () => mutation(createConversation) },
        linkProduct: { useMutation: () => mutation(link) },
        extract: { useMutation: () => mutation(extract) },
        changeConversationStageModel: { useMutation: () => mutation(changeStageModel) },
        listChatModels: {
          useQuery: () =>
            query([
              { provider: 'ollama', id: 'fixture-vision', capabilities: ['chat', 'vision'] },
              { provider: 'ollama', id: 'fixture-vision-2', capabilities: ['chat', 'vision'] },
              { provider: 'ollama', id: 'fixture-text', capabilities: ['chat'] },
              { provider: 'ollama', id: 'fixture-text-large', capabilities: ['chat'] },
              { provider: 'ollama', id: 'embedding-only', capabilities: ['embedding'] },
            ]),
        },
      },
    },
  },
}));
const requests: FakeUpload[] = [];
class FakeUpload {
  upload = {};
  onload?: () => void;
  status = 201;
  responseText = '';
  open = jest.fn();
  setRequestHeader = jest.fn();
  send = jest.fn();
  abort = jest.fn();
  constructor() {
    requests.push(this);
  }
  complete(index: number) {
    this.responseText = JSON.stringify({ id: `00000000-0000-4000-8000-00000000000${index}` });
    act(() => this.onload?.());
  }
}
beforeAll(() => {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
  });
  HTMLElement.prototype.hasPointerCapture = jest.fn();
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.releasePointerCapture = jest.fn();
  URL.createObjectURL = jest.fn(() => 'blob:fixture');
  URL.revokeObjectURL = jest.fn();
});
beforeEach(() => {
  jest.clearAllMocks();
  messages = [];
  productId = null;
  stageOverrides = { transcription: null, interpretation: null };
  failExtraction = false;
  extractionFailureMessage = 'Extraction unavailable';
  failLink = false;
  serverGenerating = false;
  cachedGenerating = false;
  queriedConversationId = null;
  requests.length = 0;
  jest
    .spyOn(window, 'XMLHttpRequest')
    .mockImplementation(() => new FakeUpload() as unknown as XMLHttpRequest);
});
const nativeUuidDescriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
afterEach(() => {
  jest.restoreAllMocks();
  if (nativeUuidDescriptor) {
    Object.defineProperty(crypto, 'randomUUID', nativeUuidDescriptor);
  } else {
    Reflect.deleteProperty(crypto, 'randomUUID');
  }
});
async function photos() {
  fireEvent.change(screen.getByLabelText('Capture photo'), {
    target: { files: [new File(['front'], 'front.jpg', { type: 'image/jpeg' })] },
  });
  fireEvent.change(screen.getByLabelText('Capture photo'), {
    target: { files: [new File(['back'], 'back.jpg', { type: 'image/jpeg' })] },
  });
  requests.forEach((request, index) => request.complete(index + 1));
  await userEvent.click(screen.getByRole('button', { name: 'Extract suggestions' }));
}
// Historical integration coverage: restore when packaging import returns to ProductEditor.
describe.skip('deferred ProductEditor packaging import', () => {
  it('integrates two camera uploads, review, save and draft linking without crypto.randomUUID', async () => {
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
    const onSaved = jest.fn();
    render(<ProductEditor product={null} onClose={jest.fn()} onSaved={onSaved} />);
    await photos();
    expect(
      extract.mock.calls[0][0].message.parts.filter(
        (p: { type: string }) => p.type === 'data-attachment'
      )
    ).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: 'Product name' })).toHaveValue('');
    expect(create).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Select non-conflicting' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply selected suggestions' }));
    expect(screen.getByRole('textbox', { name: 'Product name' })).toHaveValue('Halfvolle melk');
    expect(screen.getByRole('textbox', { name: 'Protein (g)' })).toHaveValue('3.5');
    expect(create).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Save product' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ referenceUnit: 'ML', calories: '47', fiber: null })
    );
    expect(link).toHaveBeenCalledWith({ id: 'draft', productId: productFixture.id });
  });
  it('requires confirmation to replace manual edits and preserves unrelated edits on follow-up/rejection', async () => {
    render(<ProductEditor product={null} onClose={jest.fn()} onSaved={jest.fn()} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Brand (optional)' }), 'Manual brand');
    await photos();
    await userEvent.click(screen.getByRole('button', { name: 'Select non-conflicting' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply selected suggestions' }));
    expect(screen.getByRole('textbox', { name: 'Brand (optional)' })).toHaveValue('Manual brand');
    await userEvent.type(
      screen.getByLabelText('Product prompt or correction'),
      'The brand is Jumbo'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Extract suggestions' }));
    expect(extract.mock.calls[1][0].conversationId).toBe('draft');
    expect(extract.mock.calls[1][0].message.parts).toHaveLength(1);
    await userEvent.click(screen.getByRole('checkbox', { name: /brand · Manually/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply selected suggestions' }));
    expect(screen.getByRole('textbox', { name: 'Brand (optional)' })).toHaveValue('Manual brand');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm replacement' }));
    expect(screen.getByRole('textbox', { name: 'Brand (optional)' })).toHaveValue('Jumbo');
    await userEvent.type(screen.getByLabelText('Product prompt or correction'), 'Look again');
    await userEvent.click(screen.getByRole('button', { name: 'Extract suggestions' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reject suggestions' }));
    expect(screen.getByRole('textbox', { name: 'Brand (optional)' })).toHaveValue('Jumbo');
  });
  it('restores a product conversation and photographs when reopening', async () => {
    productId = productFixture.id;
    messages = [
      {
        id: 'photo',
        role: 'user',
        parts: [
          { type: 'data-attachment', data: { attachmentId: 'photo-id' } },
          { type: 'text', text: 'Saved prompt' },
        ],
      },
    ];
    render(<ProductEditor product={productFixture} onClose={jest.fn()} onSaved={jest.fn()} />);
    expect(screen.getByText('Saved prompt')).toBeInTheDocument();
    expect(screen.getByAltText('Attached image')).toHaveAttribute(
      'src',
      '/api/attachments/photo-id'
    );
    await userEvent.type(
      screen.getByLabelText('Product prompt or correction'),
      'Read the label again'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Extract suggestions' }));
    expect(extract.mock.calls[0][0].conversationId).toBe('draft');
    expect(update).not.toHaveBeenCalled();
  });
  it('keeps text/photos after extraction failure and retries the same message', async () => {
    failExtraction = true;
    render(<ProductEditor product={null} onClose={jest.fn()} onSaved={jest.fn()} />);
    await userEvent.type(
      screen.getByLabelText('Product prompt or correction'),
      'Read these photos'
    );
    await photos();
    expect(await screen.findByText('Extraction unavailable')).toBeInTheDocument();
    expect(screen.getByLabelText('Product prompt or correction')).toHaveValue('Read these photos');
    expect(screen.getAllByAltText(/Attachment/)).toHaveLength(2);
    failExtraction = false;
    await userEvent.click(screen.getByRole('button', { name: 'Extract suggestions' }));
    expect(extract.mock.calls[1][0].message.id).toBe(extract.mock.calls[0][0].message.id);
  });
  it('retries failed first-save linking without creating another product', async () => {
    failLink = true;
    render(<ProductEditor product={null} onClose={jest.fn()} onSaved={jest.fn()} />);
    await photos();
    await userEvent.click(screen.getByRole('button', { name: 'Select non-conflicting' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply selected suggestions' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save product' }));
    expect(await screen.findByText('Finish saving')).toBeInTheDocument();
    failLink = false;
    await userEvent.click(screen.getByRole('button', { name: 'Save product' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('resumes a server draft after reload without changing the manual form', async () => {
    messages = [
      { id: 'old-prompt', role: 'user', parts: [{ type: 'text', text: 'Recover my milk import' }] },
    ];
    render(<ProductEditor product={null} onClose={jest.fn()} onSaved={jest.fn()} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Product name' }), 'Manual draft');
    await userEvent.click(screen.getByRole('combobox', { name: 'Resume an unsaved conversation' }));
    await userEvent.click(screen.getByRole('option', { name: 'Draft milk' }));
    expect(screen.getByText('Recover my milk import')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Product name' })).toHaveValue('Manual draft');
    expect(create).not.toHaveBeenCalled();
    expect(link).not.toHaveBeenCalled();
  });

  it('keeps the editor and manual input after picker return, focus refresh and backdrop taps', async () => {
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
    const onClose = jest.fn();
    const onSaved = jest.fn();
    render(<ProductEditor product={null} onClose={onClose} onSaved={onSaved} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Product name' }), 'Keep my input');
    fireEvent.blur(window);
    fireEvent.focus(window);
    fireEvent.change(screen.getByLabelText('Capture photo'), {
      target: { files: [new File(['front'], 'front.jpg', { type: 'image/jpeg' })] },
    });
    requests[0].complete(1);
    fireEvent.click(document.querySelector('.mantine-Modal-overlay')!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Product name' })).toHaveValue('Keep my input');
    expect(screen.getByAltText(/Attachment 1/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close product editor' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('selects both stages independently before a first submission while retaining prompt, photos and manual edits', async () => {
    const user = userEvent.setup();
    render(<ProductEditor product={null} onClose={jest.fn()} onSaved={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Vision transcription model' })).toHaveTextContent(
      'fixture-vision · Default'
    );
    expect(screen.getByRole('button', { name: 'Text interpretation model' })).toHaveTextContent(
      'fixture-text · Default'
    );
    await user.type(screen.getByRole('textbox', { name: 'Product name' }), 'Manual name');
    await user.type(screen.getByLabelText('Product prompt or correction'), 'Read both labels');
    fireEvent.change(screen.getByLabelText('Capture photo'), {
      target: { files: [new File(['front'], 'front.jpg', { type: 'image/jpeg' })] },
    });
    requests[0].complete(1);
    await user.click(screen.getByRole('button', { name: 'Vision transcription model' }));
    expect(screen.queryByRole('option', { name: 'fixture-text-large' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'fixture-vision-2' }));
    expect(screen.getByRole('button', { name: 'Text interpretation model' })).toHaveTextContent(
      'fixture-text · Default'
    );
    await user.click(screen.getByRole('button', { name: 'Text interpretation model' }));
    await user.click(screen.getByRole('option', { name: 'fixture-text-large' }));
    expect(screen.getByRole('button', { name: 'Vision transcription model' })).toHaveTextContent(
      'fixture-vision-2'
    );
    expect(screen.getByLabelText('Product prompt or correction')).toHaveValue('Read both labels');
    expect(screen.getByAltText(/Attachment 1/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Product name' })).toHaveValue('Manual name');
    expect(changeStageModel).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Extract suggestions' }));
    expect(createConversation).toHaveBeenCalledWith({
      selection: { provider: 'ollama', modelId: 'fixture-vision-2' },
      stageOverrides: {
        transcription: { provider: 'ollama', modelId: 'fixture-vision-2' },
        interpretation: { provider: 'ollama', modelId: 'fixture-text-large' },
      },
    });
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({ rereadImages: false }));
    expect(screen.getByRole('textbox', { name: 'Product name' })).toHaveValue('Manual name');
  });

  it('persists one conversation stage without resetting the other and restores both selections on reload', async () => {
    const user = userEvent.setup();
    productId = productFixture.id;
    stageOverrides = {
      transcription: { provider: 'ollama', modelId: 'fixture-vision-2' },
      interpretation: null,
    };
    const { unmount } = render(
      <ProductEditor product={productFixture} onClose={jest.fn()} onSaved={jest.fn()} />
    );
    await user.click(screen.getByRole('button', { name: 'Text interpretation model' }));
    await user.click(screen.getByRole('option', { name: 'fixture-text-large' }));
    expect(changeStageModel).toHaveBeenCalledWith({
      id: 'draft',
      stage: 'interpretation',
      selection: { provider: 'ollama', modelId: 'fixture-text-large' },
    });
    expect(stageOverrides.transcription?.modelId).toBe('fixture-vision-2');
    unmount();
    render(<ProductEditor product={productFixture} onClose={jest.fn()} onSaved={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Vision transcription model' })).toHaveTextContent(
      'fixture-vision-2'
    );
    expect(screen.getByRole('button', { name: 'Text interpretation model' })).toHaveTextContent(
      'fixture-text-large'
    );
    expect(screen.getByRole('button', { name: 'Text interpretation model' })).not.toHaveTextContent(
      'Default'
    );
    await user.click(screen.getByRole('button', { name: 'Vision transcription model' }));
    await user.click(screen.getByRole('option', { name: /Use default/ }));
    expect(changeStageModel).toHaveBeenLastCalledWith({
      id: 'draft',
      stage: 'transcription',
      selection: null,
    });
    expect(stageOverrides.interpretation?.modelId).toBe('fixture-text-large');
    expect(screen.getByRole('button', { name: 'Vision transcription model' })).toHaveTextContent(
      'fixture-vision · Default'
    );
  });

  it('identifies the failing stage, keeps selections and attachments, and sends explicit visual reread on retry', async () => {
    const user = userEvent.setup();
    failExtraction = true;
    extractionFailureMessage = 'Text interpretation failed: model timed out';
    render(<ProductEditor product={null} onClose={jest.fn()} onSaved={jest.fn()} />);
    await user.type(screen.getByLabelText('Product prompt or correction'), 'Keep this prompt');
    await photos();
    expect(
      await screen.findByText('Text interpretation failed: model timed out')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vision transcription model' })).toHaveTextContent(
      'fixture-vision · Default'
    );
    expect(screen.getByRole('button', { name: 'Text interpretation model' })).toHaveTextContent(
      'fixture-text · Default'
    );
    expect(screen.getAllByAltText(/Attachment/)).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Text interpretation model' }));
    await user.click(screen.getByRole('option', { name: 'fixture-text-large' }));
    expect(screen.getByLabelText('Product prompt or correction')).toHaveValue('Keep this prompt');
    await user.click(screen.getByRole('checkbox', { name: 'Read photographs again' }));
    failExtraction = false;
    await user.click(screen.getByRole('button', { name: 'Extract suggestions' }));
    expect(extract.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        rereadImages: true,
        message: expect.objectContaining({ id: expect.any(String) }),
      })
    );
    expect(extract.mock.calls[1][0].message.id).not.toBe(extract.mock.calls[0][0].message.id);
    expect(screen.getByRole('checkbox', { name: 'Read photographs again' })).not.toBeChecked();
    expect(changeStageModel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Vision transcription model' })).toHaveTextContent(
      'fixture-vision · Default'
    );
  });

  it('refreshes a failed first generation lease, retaining its conversation and unchanged retry message', async () => {
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    extract.mockImplementationOnce(async () => {
      serverGenerating = true;
      await pending;
      serverGenerating = false;
      throw new Error('Text interpretation failed: interrupted');
    });
    render(<ProductEditor product={null} onClose={jest.fn()} onSaved={jest.fn()} />);
    await userEvent.type(screen.getByLabelText('Product prompt or correction'), 'Keep my draft');
    await photos();
    expect(
      await screen.findByText('A response is still running. Reload history after it finishes.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Extract suggestions' })).toBeDisabled();
    await act(async () => {
      release();
    });
    expect(await screen.findByText('Text interpretation failed: interrupted')).toBeInTheDocument();
    expect(invalidateHistory).toHaveBeenCalledWith({ id: 'draft' });
    expect(
      screen.queryByText('A response is still running. Reload history after it finishes.')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Extract suggestions' })).toBeEnabled();
    expect(screen.getAllByAltText(/Attachment/)).toHaveLength(2);
    expect(screen.getByLabelText('Product prompt or correction')).toHaveValue('Keep my draft');
    await userEvent.click(screen.getByRole('button', { name: 'Extract suggestions' }));
    expect(createConversation).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[1][0].message.id).toBe(extract.mock.calls[0][0].message.id);
  });

  it('treats successful extraction as accepted even when refreshing its history fails', async () => {
    invalidateHistory.mockRejectedValueOnce(new Error('Refresh unavailable'));
    render(<ProductEditor product={null} onClose={jest.fn()} onSaved={jest.fn()} />);
    await userEvent.type(
      screen.getByLabelText('Product prompt or correction'),
      'Read these photos'
    );
    await photos();
    expect(await screen.findByText(/AI history could not be refreshed/)).toBeInTheDocument();
    expect(screen.getByLabelText('Product prompt or correction')).toHaveValue('');
    expect(screen.queryAllByAltText(/Attachment [0-9]/)).toHaveLength(0);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(createConversation).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Vision transcription', 'fixture-vision-2'],
    ['Text interpretation', 'fixture-text-large'],
    ['visual reread', null],
  ])(
    'starts a new request when only %s changes after a failed response',
    async (stage, modelId) => {
      const user = userEvent.setup();
      failExtraction = true;
      render(<ProductEditor product={null} onClose={jest.fn()} onSaved={jest.fn()} />);
      await user.type(
        screen.getByLabelText('Product prompt or correction'),
        'Read the same photos'
      );
      await photos();
      expect(await screen.findByText('Extraction unavailable')).toBeInTheDocument();
      if (modelId) {
        await user.click(screen.getByRole('button', { name: `${stage} model` }));
        await user.click(screen.getByRole('option', { name: modelId }));
      } else {
        await user.click(screen.getByRole('checkbox', { name: 'Read photographs again' }));
      }
      failExtraction = false;
      await user.click(screen.getByRole('button', { name: 'Extract suggestions' }));
      expect(extract.mock.calls[1][0].message.id).not.toBe(extract.mock.calls[0][0].message.id);
      expect(extract.mock.calls[1][0].message.parts).toEqual(
        extract.mock.calls[0][0].message.parts
      );
      expect(createConversation).toHaveBeenCalledTimes(1);
    }
  );
});
