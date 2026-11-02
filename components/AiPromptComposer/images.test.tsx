import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { AiPromptComposer } from './AiPromptComposer';
import { AttachmentImage } from './AttachmentImage';
import type { ModelPickerProps } from './ModelPicker';

const selection = { provider: 'ollama' as const, modelId: 'vision' };
const picker: ModelPickerProps = {
  models: [{ provider: 'ollama', id: 'vision', capabilities: ['chat', 'vision'] }],
  override: selection,
  onChange: jest.fn(),
  resolution: {
    selection,
    source: 'Override',
    loading: false,
    error: null,
    defaultSelection: selection,
    defaultSource: 'Default',
    defaultLoading: false,
    defaultError: null,
  },
};
const ids = ['9fc67afc-49ec-4084-bcf7-2542633271ec', '10e534f1-47ec-4ff7-a12d-a9b98ecc73c5'];
const file = (name = 'front.jpg') => new File(['photo'], name, { type: 'image/jpeg' });
const requests: FakeRequest[] = [];
class FakeRequest {
  upload = { onprogress: null as ((event: unknown) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  open = jest.fn();
  setRequestHeader = jest.fn();
  send = jest.fn();
  abort = jest.fn();
  status = 201;
  responseText = '';
  constructor() {
    requests.push(this);
  }
  complete(id: string) {
    this.responseText = JSON.stringify({ id });
    act(() => this.onload?.());
  }
}

beforeAll(() => {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
  });
  URL.createObjectURL = jest.fn(() => 'blob:preview');
  URL.revokeObjectURL = jest.fn();
});
beforeEach(() => {
  requests.length = 0;
  jest
    .spyOn(window, 'XMLHttpRequest')
    .mockImplementation(() => new FakeRequest() as unknown as XMLHttpRequest);
});
afterEach(() => jest.restoreAllMocks());

function composer(overrides = {}) {
  return (
    <AiPromptComposer
      value=""
      onChange={jest.fn()}
      onSubmit={jest.fn()}
      modelPicker={picker}
      allowImages
      {...overrides}
    />
  );
}
function select(files: File[], camera = false) {
  fireEvent.change(screen.getByLabelText(camera ? 'Capture photo' : 'Select images'), {
    target: { files },
  });
}

it('appends sequential camera captures and submits only persistent IDs in capture order', async () => {
  const onSubmit = jest.fn();
  const { unmount } = render(composer({ onSubmit }));
  expect(screen.getByLabelText('Capture photo')).toHaveAttribute('capture', 'environment');
  const first = file();
  select([first], true);
  select([file('back.jpg')], true);
  expect(screen.getAllByRole('img')).toHaveLength(2);
  expect(screen.getByLabelText('Capture photo')).toHaveValue('');
  expect(requests[0].open).toHaveBeenCalledWith('POST', '/api/attachments');
  expect(requests[0].send).toHaveBeenCalledWith(first);
  expect(requests[0].setRequestHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
  act(() => requests[0].upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 }));
  expect(screen.getByText('Uploading 50%')).toBeInTheDocument();
  requests[1].complete(ids[1]);
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  requests[0].complete(ids[0]);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Send' }));
  expect(onSubmit).toHaveBeenCalledWith(ids);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});

it('supports multi-select, drops and pasted images without intercepting ordinary text paste', async () => {
  const onSubmit = jest.fn();
  render(composer({ onSubmit }));
  select([file(), file('back.jpg')]);
  const input = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.drop(input, { dataTransfer: { files: [file('side.jpg')] } });
  fireEvent.paste(input, {
    clipboardData: {
      items: [{ kind: 'file', type: 'image/jpeg', getAsFile: () => file('paste.jpg') }],
    },
  });
  expect(requests).toHaveLength(4);
  requests.forEach((request) => request.complete(ids[0]));
  await userEvent.setup().click(screen.getByRole('button', { name: 'Remove image 2' }));
  await userEvent.setup().click(screen.getByRole('button', { name: 'Send' }));
  expect(onSubmit).toHaveBeenCalledWith([ids[0], ids[0], ids[0]]);
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { items: [] } });
  fireEvent(input, paste);
  expect(paste.defaultPrevented).toBe(false);
});

it('keeps failed images and text, blocks sending, and allows retry or removal', async () => {
  render(composer({ value: 'Read this label' }));
  select([file()]);
  act(() => requests[0].onerror?.());
  expect(screen.getByRole('alert')).toHaveTextContent('Upload failed');
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry upload' }));
  requests[1].complete(ids[0]);
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  expect(screen.getByRole('textbox')).toHaveValue('Read this label');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Remove image 1' }));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('preserves the draft when switching to an incompatible or unknown model', () => {
  const { rerender } = render(composer({ value: 'Keep me' }));
  select([file()]);
  requests[0].complete(ids[0]);
  rerender(<>{composer({ value: 'Keep me', modelPicker: { ...picker, models: [] } })}</>);
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(screen.getByText(/Choose an image-capable model/)).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('Keep me');
  expect(screen.getByRole('img')).toBeInTheDocument();
  rerender(<>{composer({ value: 'Keep me' })}</>);
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
});

it('blocks text follow-ups to image history on a text-only model', () => {
  render(
    composer({ value: 'Follow up', hasImageHistory: true, modelPicker: { ...picker, models: [] } })
  );
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});

it('rejects unsupported, empty, oversized and excess files before upload', () => {
  render(composer());
  select([new File(['heic'], 'photo.heic', { type: 'image/heic' })]);
  expect(screen.getByRole('alert')).toHaveTextContent('HEIC');
  select([new File([], 'empty.jpg', { type: 'image/jpeg' })]);
  expect(screen.getByRole('alert')).toHaveTextContent('10 MiB');
  const large = file();
  Object.defineProperty(large, 'size', { value: 10 * 1024 * 1024 + 1 });
  select([large]);
  expect(requests).toHaveLength(0);
  select(Array.from({ length: 9 }, () => file()));
  expect(requests).toHaveLength(8);
  expect(screen.getByRole('alert')).toHaveTextContent('up to 8');
});

it('shows server rejection and timeout errors and aborts removed/in-flight uploads', async () => {
  const { unmount } = render(composer());
  select([file(), file('back.jpg')]);
  requests[0].status = 413;
  requests[0].responseText = JSON.stringify({ error: 'Image is too large.' });
  act(() => requests[0].onload?.());
  expect(screen.getByText('Image is too large.')).toBeInTheDocument();
  act(() => requests[1].ontimeout?.());
  expect(screen.getByText(/Upload timed out/)).toBeInTheDocument();
  select([file('third.jpg')]);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Remove image 3' }));
  expect(requests[2].abort).toHaveBeenCalled();
  select([file('fourth.jpg')]);
  unmount();
  expect(requests[3].abort).toHaveBeenCalled();
});

it('loads a saved attachment through the private endpoint and explains unavailable images', () => {
  const { unmount } = render(<AttachmentImage attachmentId={ids[0]} />);
  expect(screen.getByRole('img')).toHaveAttribute('src', `/api/attachments/${ids[0]}`);
  unmount();
  render(<AttachmentImage attachmentId={ids[0]} />);
  fireEvent.error(screen.getByRole('img'));
  expect(screen.getByRole('status')).toHaveTextContent('Image unavailable');
});

it('uses only the designated vision stage for image compatibility and preserves photos on failure or model changes', async () => {
  const textSelection = { provider: 'ollama' as const, modelId: 'text-only' };
  const textPicker: ModelPickerProps = {
    ...picker,
    models: [{ provider: 'ollama', id: 'text-only', capabilities: ['chat'] }],
    override: textSelection,
    resolution: { ...picker.resolution, selection: textSelection, defaultSelection: textSelection },
  };
  const onSubmit = jest.fn(async () => false);
  const multiComposer = (visionPicker = picker, interpreter = textPicker) => (
    <AiPromptComposer
      value="Keep this correction"
      onChange={jest.fn()}
      onSubmit={onSubmit}
      allowImages
      imageStageId="read"
      modelPickers={[
        { ...interpreter, id: 'interpret', label: 'Interpret', requiredCapabilities: ['chat'] },
        { ...visionPicker, id: 'read', label: 'Read', requiredCapabilities: ['chat', 'vision'] },
      ]}
    />
  );
  const { rerender } = render(multiComposer());
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
  select([file()]);
  requests[0].complete(ids[0]);
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(onSubmit).toHaveBeenCalledWith([ids[0]]);
  expect(screen.getByRole('img')).toBeInTheDocument();
  rerender(<>{multiComposer(textPicker)}</>);
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(screen.getByRole('img')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep this correction');
  rerender(<>{multiComposer()}</>);
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
});
