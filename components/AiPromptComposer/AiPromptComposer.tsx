'use client';

import { useId, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  Alert,
  Anchor,
  Button,
  Group,
  Image,
  Paper,
  Progress,
  Stack,
  Text,
  Textarea,
  type TextareaProps,
} from '@mantine/core';
import { maxMessageImages } from '@/lib/ai-dev/schema';
import { imageMimeTypes } from '@/lib/attachments/limits';
import { modelInputSupport } from '@/lib/ai/capabilities';
import { useImageUploads } from './useImageUploads';
import { ModelPicker, modelSelectionIssue, type ModelPickerProps } from './ModelPicker';
import classes from './AiPromptComposer.module.css';

export type ModelPickerStage = ModelPickerProps & {
  /** Stable identifier used to retain each picker's state across renders. */
  id: string;
  label: string;
  help?: ReactNode;
};

export type AiPromptComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (attachmentIds: string[]) => void | Promise<boolean | void>;
  allowImages?: boolean;
  hasImageHistory?: boolean;
  textareaProps?: Omit<TextareaProps, 'value' | 'onChange' | 'bottomSection' | 'onKeyDown'>;
  inputRef?: Ref<HTMLTextAreaElement>;
  submitLabel?: string;
  submitDisabled?: boolean;
  submitting?: boolean;
  onStop?: () => void;
  sendShortcut?: 'enter' | 'shift-enter';
  allowEmpty?: boolean;
} & (
  | { modelPicker: ModelPickerProps; modelPickers?: never; imageStageId?: never }
  | {
      modelPicker?: never;
      modelPickers: ModelPickerStage[];
      /** Stage that receives photographs; otherwise the first vision stage is used. */
      imageStageId?: string;
    }
);

export function AiPromptComposer({
  value,
  onChange,
  onSubmit,
  modelPicker,
  modelPickers,
  imageStageId,
  textareaProps,
  inputRef,
  submitLabel = 'Send',
  submitDisabled,
  submitting,
  onStop,
  sendShortcut = 'enter',
  allowEmpty = false,
  allowImages = false,
  hasImageHistory = false,
}: AiPromptComposerProps) {
  const composerId = useId();
  const uploads = useImageUploads();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const imagePicker =
    modelPicker ??
    (imageStageId
      ? modelPickers.find((stage) => stage.id === imageStageId)
      : modelPickers.find((stage) => stage.requiredCapabilities?.includes('vision')));
  const selectedModel = imagePicker?.models.find(
    (model) =>
      model.provider === imagePicker.resolution.selection?.provider &&
      model.id === imagePicker.resolution.selection?.modelId
  );
  const selectionIssues =
    modelPickers?.flatMap((stage) => {
      const message = stage.resolution.error?.message ?? modelSelectionIssue(stage);
      return message ? [{ id: stage.id, label: stage.label, message }] : [];
    }) ?? [];
  const imageCapable = Boolean(selectedModel && modelInputSupport(selectedModel).image);
  const disabled = Boolean(submitting || textareaProps?.disabled);
  const canAttach = allowImages && imageCapable && !disabled;
  const incompatible = allowImages && !imageCapable;
  const pendingImages = uploads.images.some((image) => !image.attachmentId);
  const canSubmit =
    (allowEmpty || Boolean(value.trim()) || uploads.images.length > 0) &&
    !pendingImages &&
    !(incompatible && (uploads.images.length > 0 || hasImageHistory)) &&
    !submitDisabled &&
    !selectionIssues.length &&
    !modelPickers?.some((stage) => stage.resolution.loading || !stage.resolution.selection) &&
    !submitting &&
    !textareaProps?.disabled;
  const submit = async () => {
    const accepted = await onSubmit(
      uploads.images.flatMap((image) => (image.attachmentId ? [image.attachmentId] : []))
    );
    if (accepted !== false) {
      uploads.clear();
    }
  };
  const addImages = (files: File[]) => {
    if (canAttach) {
      uploads.add(files);
    } else if (allowImages) {
      uploads.setError(
        disabled
          ? 'Wait for the current response before attaching images.'
          : 'Choose an image-capable model to attach photos.'
      );
    }
  };
  return (
    // Drag/drop and paste supplement the keyboard-accessible upload buttons.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <form
      className={classes.composer}
      data-dragging={dragging || undefined}
      onDragOver={(event) => {
        if (allowImages && event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        if (!allowImages) {
          return;
        }
        event.preventDefault();
        setDragging(false);
        addImages(Array.from(event.dataTransfer.files));
      }}
      onPaste={(event) => {
        if (!allowImages) {
          return;
        }
        const files = Array.from(event.clipboardData.items)
          .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
          .flatMap((item) => {
            const file = item.getAsFile();
            return file ? [file] : [];
          });
        if (files.length) {
          event.preventDefault();
          addImages(files);
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (canSubmit) {
          void submit();
        }
      }}
    >
      <Stack gap="xs">
        {modelPickers && (
          <div className={classes.stages}>
            {modelPickers.map(({ id, label, help, ...picker }) => (
              <div key={id} className={classes.stage} role="group" aria-label={label}>
                <Text size="xs" fw={600}>
                  {label}
                </Text>
                <ModelPicker
                  {...picker}
                  label={`${label} model`}
                  describedBy={help ? `${composerId}-${id}-help` : undefined}
                />
                {help && (
                  <Text id={`${composerId}-${id}-help`} size="xs" c="dimmed">
                    {help}
                  </Text>
                )}
              </div>
            ))}
          </div>
        )}
        {allowImages && (
          <>
            <input
              hidden
              ref={fileInput}
              type="file"
              accept={imageMimeTypes.join(',')}
              multiple
              aria-label="Select images"
              onChange={(event) => {
                addImages(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = '';
              }}
            />
            <input
              hidden
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="Capture photo"
              onChange={(event) => {
                addImages(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = '';
              }}
            />
            <Group gap="xs">
              <Button
                type="button"
                variant="default"
                mih={44}
                disabled={!canAttach}
                onClick={() => fileInput.current?.click()}
              >
                Upload image
              </Button>
              <Button
                type="button"
                variant="default"
                mih={44}
                disabled={!canAttach}
                onClick={() => cameraInput.current?.click()}
              >
                Take photo
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              JPEG, PNG or WebP · Up to {maxMessageImages} images, 10 MiB each. Drop or paste images
              here. Take photo opens your camera where supported, or a file picker.
            </Text>
            {incompatible && (
              <Alert color="yellow">
                Choose an image-capable model to use photos. Your text and attached images are kept.
              </Alert>
            )}
            {dragging && <Text role="status">Drop images to attach</Text>}
            <Group gap="xs" align="flex-start">
              {uploads.images.map((image, index) => (
                <Paper
                  key={image.key}
                  withBorder
                  p="xs"
                  radius="sm"
                  className={classes.imagePreview}
                >
                  <Stack gap={4}>
                    <Anchor
                      href={image.preview}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Inspect image ${index + 1}`}
                    >
                      <Image
                        src={image.preview}
                        alt={`Attachment ${index + 1}: ${image.file.name}`}
                        h={96}
                        fit="contain"
                        radius="sm"
                      />
                    </Anchor>
                    <Text size="xs" truncate title={image.file.name}>
                      {image.file.name}
                    </Text>
                    {image.attachmentId ? (
                      <Text size="xs" role="status">
                        Uploaded
                      </Text>
                    ) : image.error ? (
                      <>
                        <Text size="xs" c="red" role="alert">
                          {image.error}
                        </Text>
                        <Button
                          type="button"
                          variant="light"
                          disabled={!canAttach}
                          onClick={() => uploads.retry(image)}
                        >
                          Retry upload
                        </Button>
                      </>
                    ) : (
                      <>
                        <Progress
                          value={image.progress}
                          aria-label={`Uploading ${image.file.name}`}
                        />
                        <Text size="xs" role="status">
                          Uploading {image.progress}%
                        </Text>
                      </>
                    )}
                    <Button
                      type="button"
                      variant="subtle"
                      color="red"
                      mih={44}
                      disabled={disabled}
                      aria-label={`Remove image ${index + 1}`}
                      onClick={() => uploads.remove(image.key)}
                    >
                      Remove
                    </Button>
                  </Stack>
                </Paper>
              ))}
            </Group>
            {uploads.error && (
              <Alert
                color="red"
                role="alert"
                withCloseButton
                onClose={() => uploads.setError(null)}
              >
                {uploads.error}
              </Alert>
            )}
          </>
        )}
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
          classNames={{ wrapper: classes.inputWrapper }}
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
                void submit();
              }
            }
          }}
          bottomSection={
            <div className={classes.footer} data-with-model={modelPicker ? true : undefined}>
              {modelPicker && <ModelPicker {...modelPicker} />}
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
        {modelPicker?.resolution.error && (
          <Alert color="red">{modelPicker.resolution.error.message}</Alert>
        )}
        {selectionIssues.map((issue) => (
          <Alert key={issue.id} color="red" title={issue.label} role="alert">
            {issue.message}
          </Alert>
        ))}
      </Stack>
    </form>
  );
}
