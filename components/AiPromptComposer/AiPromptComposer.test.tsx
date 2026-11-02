import { useState } from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import type { ModelSelection } from '@/lib/model-settings/schema';
import { AiPromptComposer, type ModelPickerStage } from './AiPromptComposer';
import { ModelPicker, type ModelPickerProps } from './ModelPicker';

const defaultModel: ModelSelection = { provider: 'ollama', modelId: 'qwen3:8b' };
const props: ModelPickerProps = {
  models: [
    { provider: 'ollama', id: 'qwen3:8b', capabilities: ['chat'] },
    { provider: 'ollama', id: 'gemma3:12b', capabilities: ['chat', 'vision'] },
    { provider: 'ollama', id: 'embedding-only', capabilities: ['embedding'] },
  ],
  override: null,
  onChange: jest.fn(),
  resolution: {
    selection: defaultModel,
    source: 'Balanced default',
    loading: false,
    error: null,
    defaultSelection: defaultModel,
    defaultSource: 'Balanced default',
    defaultLoading: false,
    defaultError: null,
  },
};

beforeAll(() => {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
  });
});

it('groups chat models by provider, marks the default, and allows pinning that model', async () => {
  const user = userEvent.setup();
  const onChange = jest.fn();
  render(<ModelPicker {...props} onChange={onChange} />);
  await user.click(screen.getByRole('button', { name: 'Chat model' }));
  expect(screen.getByText('Ollama')).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /embedding-only/ })).not.toBeInTheDocument();
  expect(screen.getByText('qwen3:8b · Balanced default')).toBeInTheDocument();
  const option = screen.getByRole('option', { name: 'qwen3:8b Default' });
  expect(within(option).getByText('Default')).toBeInTheDocument();
  await user.click(option);
  expect(onChange).toHaveBeenCalledWith(defaultModel);
  expect(screen.getByRole('button', { name: 'Chat model' })).toHaveFocus();
});

it('searches models and preserves a separate choice to follow settings', async () => {
  const user = userEvent.setup();
  const onChange = jest.fn();
  render(<ModelPicker {...props} override={defaultModel} onChange={onChange} />);
  await user.click(screen.getByRole('button', { name: 'Chat model' }));
  await user.type(screen.getByRole('textbox', { name: 'Search models' }), 'GEMMA');
  expect(screen.queryByRole('option', { name: 'qwen3:8b Default' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'gemma3:12b' })).toBeInTheDocument();
  await user.click(screen.getByRole('option', { name: /Use default/ }));
  expect(onChange).toHaveBeenCalledWith(null);
});

it('keeps unavailable overrides visible while allowing recovery', async () => {
  const user = userEvent.setup();
  const missing = { ...defaultModel, modelId: 'missing' };
  render(
    <ModelPicker
      {...props}
      override={missing}
      resolution={{ ...props.resolution, selection: missing }}
    />
  );
  await user.click(screen.getByRole('button', { name: 'Chat model' }));
  expect(screen.getByRole('option', { name: 'missing · Unavailable' })).toHaveAttribute(
    'aria-disabled',
    'true'
  );
  expect(screen.getByRole('option', { name: /Use default/ })).not.toHaveAttribute(
    'aria-disabled',
    'true'
  );
});

function Composer({
  onSubmit,
  sendShortcut = 'enter',
}: {
  onSubmit: () => void;
  sendShortcut?: 'enter' | 'shift-enter';
}) {
  const [value, setValue] = useState('');
  return (
    <AiPromptComposer
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      modelPicker={props}
      sendShortcut={sendShortcut}
    />
  );
}

it('sends from the footer and ignores composition, repeated keys, and blank prompts', async () => {
  const user = userEvent.setup();
  const onSubmit = jest.fn();
  render(<Composer onSubmit={onSubmit} />);
  const input = screen.getByRole('textbox', { name: 'Message' });
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  await user.type(input, 'Hello');
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(input, { key: 'Enter', repeat: true });
  expect(onSubmit).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Send' }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it('supports Shift+Enter submission for features that use that shortcut', async () => {
  const user = userEvent.setup();
  const onSubmit = jest.fn();
  render(<Composer onSubmit={onSubmit} sendShortcut="shift-enter" />);
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hello{Enter}world');
  expect(onSubmit).not.toHaveBeenCalled();
  await user.keyboard('{Shift>}{Enter}{/Shift}');
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it('keeps Stop available while generation disables typing and model changes', async () => {
  const user = userEvent.setup();
  const onStop = jest.fn();
  render(
    <AiPromptComposer
      value=""
      onChange={jest.fn()}
      onSubmit={jest.fn()}
      modelPicker={{ ...props, disabled: true }}
      textareaProps={{ disabled: true }}
      submitting
      onStop={onStop}
    />
  );
  expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Chat model' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Stop response' }));
  expect(onStop).toHaveBeenCalledTimes(1);
});

it('allows empty guidance only when explicitly enabled', async () => {
  const onSubmit = jest.fn();
  render(
    <AiPromptComposer
      value=""
      onChange={jest.fn()}
      onSubmit={onSubmit}
      modelPicker={props}
      allowEmpty
      submitLabel="Generate preview"
    />
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Generate preview' }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

const visionSelection: ModelSelection = { provider: 'ollama', modelId: 'gemma3:12b' };
const stages = (onVision = jest.fn(), onText = jest.fn()): ModelPickerStage[] => [
  {
    ...props,
    id: 'vision',
    label: 'Read photographs',
    help: 'Preserves the original printed evidence.',
    requiredCapabilities: ['chat', 'vision'],
    resolution: {
      ...props.resolution,
      selection: visionSelection,
      defaultSelection: visionSelection,
    },
    onChange: onVision,
  },
  {
    ...props,
    id: 'interpret',
    label: 'Interpret evidence',
    requiredCapabilities: ['chat'],
    onChange: onText,
  },
];

it('supports independently controlled named pickers with stage-specific capabilities and help', async () => {
  const user = userEvent.setup();
  const onVision = jest.fn();
  const onText = jest.fn();
  render(
    <AiPromptComposer
      value="Read this"
      onChange={jest.fn()}
      onSubmit={jest.fn()}
      modelPickers={stages(onVision, onText)}
      imageStageId="vision"
      allowImages
    />
  );
  expect(
    screen.getByRole('button', { name: 'Read photographs model' })
  ).toHaveAccessibleDescription('Preserves the original printed evidence.');
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Read photographs model' }));
  expect(screen.queryByRole('option', { name: /qwen3/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /embedding-only/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('option', { name: /gemma3:12b Default/ }));
  expect(onVision).toHaveBeenCalledWith(visionSelection);
  expect(onText).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Interpret evidence model' }));
  await user.click(screen.getByRole('option', { name: 'qwen3:8b Default' }));
  expect(onText).toHaveBeenCalledWith(defaultModel);
  expect(onVision).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Read this');
});

it('retains inherited and explicit selections when controlled stages are restored or reordered', async () => {
  const user = userEvent.setup();
  const onVision = jest.fn();
  const onText = jest.fn();
  const restored = stages(onVision, onText);
  restored[0].override = visionSelection;
  const composer = (modelPickers: ModelPickerStage[]) => (
    <AiPromptComposer
      value="Correction"
      onChange={jest.fn()}
      onSubmit={jest.fn()}
      modelPickers={modelPickers}
    />
  );
  const { rerender } = render(composer(restored));
  expect(screen.getByRole('button', { name: 'Read photographs model' })).toHaveTextContent(
    'gemma3:12b'
  );
  expect(screen.getByRole('button', { name: 'Read photographs model' })).not.toHaveTextContent(
    'Default'
  );
  expect(screen.getByRole('button', { name: 'Interpret evidence model' })).toHaveTextContent(
    'Default'
  );
  rerender(<>{composer([...restored].reverse())}</>);
  await user.click(screen.getByRole('button', { name: 'Read photographs model' }));
  await user.click(screen.getByRole('option', { name: /Use default/ }));
  expect(onVision).toHaveBeenCalledWith(null);
  expect(onText).not.toHaveBeenCalled();
});

it.each([
  ['missing-model', /missing-model is unavailable/, 'Unavailable'],
  ['qwen3:8b', /qwen3:8b is incompatible: requires vision/, 'Incompatible'],
])(
  'keeps an unsupported %s stage visible with a clear error and blocks submission',
  async (modelId, error, status) => {
    const user = userEvent.setup();
    const modelPickers = stages();
    const override: ModelSelection = { provider: 'ollama', modelId };
    modelPickers[0] = {
      ...modelPickers[0],
      override,
      resolution: { ...props.resolution, selection: override },
    };
    render(
      <AiPromptComposer
        value="Keep this"
        onChange={jest.fn()}
        onSubmit={jest.fn()}
        modelPickers={modelPickers}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(error);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Read photographs model' }));
    expect(screen.getByRole('option', { name: `${modelId} · ${status}` })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep this');
  }
);

it('validates inherited selections too and supports more than two configurable stages', () => {
  const modelPickers = stages();
  modelPickers.push({
    ...props,
    id: 'final',
    label: 'Final review',
    requiredCapabilities: ['chat'],
  });
  modelPickers[1].resolution = {
    ...props.resolution,
    selection: { provider: 'ollama', modelId: 'not-installed' },
  };
  render(
    <AiPromptComposer
      value="Hello"
      onChange={jest.fn()}
      onSubmit={jest.fn()}
      modelPickers={modelPickers}
    />
  );
  expect(screen.getByRole('group', { name: 'Final review' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('not-installed is unavailable');
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});
