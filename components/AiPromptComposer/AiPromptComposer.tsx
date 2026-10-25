'use client';

import type { Ref } from 'react';
import { Alert, Button, Stack, Textarea, type TextareaProps } from '@mantine/core';
import { ModelPicker, type ModelPickerProps } from './ModelPicker';
import classes from './AiPromptComposer.module.css';

type AiPromptComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  modelPicker: ModelPickerProps;
  textareaProps?: Omit<TextareaProps, 'value' | 'onChange' | 'bottomSection' | 'onKeyDown'>;
  inputRef?: Ref<HTMLTextAreaElement>;
  submitLabel?: string;
  submitDisabled?: boolean;
  submitting?: boolean;
  onStop?: () => void;
  sendShortcut?: 'enter' | 'shift-enter';
};

export function AiPromptComposer({
  value,
  onChange,
  onSubmit,
  modelPicker,
  textareaProps,
  inputRef,
  submitLabel = 'Send',
  submitDisabled,
  submitting,
  onStop,
  sendShortcut = 'enter',
}: AiPromptComposerProps) {
  const canSubmit =
    Boolean(value.trim()) && !submitDisabled && !submitting && !textareaProps?.disabled;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          onSubmit();
        }
      }}
    >
      <Stack gap="xs">
        <Textarea
          label="Message"
          placeholder="Write a message…"
          autosize
          minRows={2}
          maxRows={8}
          description={
            sendShortcut === 'enter'
              ? 'Enter to send · Shift+Enter for a new line'
              : 'Shift+Enter to send · Enter for a new line'
          }
          {...textareaProps}
          styles={{
            wrapper: { '--input-bottom-section-height': 'calc(2.5rem * var(--mantine-scale))' },
          }}
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.nativeEvent.isComposing &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              event.shiftKey === (sendShortcut === 'shift-enter')
            ) {
              event.preventDefault();
              if (!event.repeat && canSubmit) {
                onSubmit();
              }
            }
          }}
          bottomSection={
            <div className={classes.footer}>
              <ModelPicker {...modelPicker} />
              {submitting && onStop ? (
                <Button type="button" size="compact-sm" variant="default" onClick={onStop}>
                  Stop response
                </Button>
              ) : (
                <Button type="submit" size="compact-sm" loading={submitting} disabled={!canSubmit}>
                  {submitLabel}
                </Button>
              )}
            </div>
          }
        />
        {modelPicker.resolution.error && (
          <Alert color="red">{modelPicker.resolution.error.message}</Alert>
        )}
      </Stack>
    </form>
  );
}
