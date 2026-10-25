import { useState } from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import type { ModelSelection } from '@/lib/model-settings/schema';
import { AiPromptComposer } from './AiPromptComposer';
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
