'use client';

import { createClientId } from '@/lib/client-id';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Group, Paper, Select, Stack, Text } from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import type { ProductInput } from '@/lib/nutrition/schema';
import type { ModelSelection } from '@/lib/model-settings/schema';
import { productSuggestionSchema } from '@/lib/nutrition/product-extraction/schema';
import type { ChatInput } from '@/lib/ai-dev/schema';
import { AiPromptComposer } from '@/components/AiPromptComposer/AiPromptComposer';
import { AttachmentImage } from '@/components/AiPromptComposer/AttachmentImage';
import { useFeatureModel } from '@/components/ModelSettings/FeatureModelSelect';
import { ProductSuggestionReview } from './ProductSuggestionReview';

type ExtractionStage = 'transcription' | 'interpretation';

export function ProductImport({
  productId,
  value,
  touched,
  disabled,
  onApply,
  onConversation,
  onBusy,
}: {
  productId?: string;
  value: ProductInput;
  touched: ReadonlySet<keyof ProductInput>;
  disabled: boolean;
  onApply: (patch: Partial<ProductInput>) => void;
  onConversation: (id: string | null) => void;
  onBusy: (busy: boolean) => void;
}) {
  const api = trpc.nutrition.productChat;
  const utils = trpc.useUtils();
  const list = api.listConversations.useQuery(undefined, { retry: false });
  const linked = api.listForProduct.useQuery(
    { productId: productId! },
    { enabled: !!productId, retry: false }
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const id = chosen ?? linked.data?.[0]?.id ?? null;
  const history = api.getConversation.useQuery({ id: id! }, { enabled: !!id, retry: false });
  const create = api.createConversation.useMutation();
  const link = api.linkProduct.useMutation();
  const extract = api.extract.useMutation();
  const changeModel = api.changeConversationStageModel.useMutation();
  const models = api.listChatModels.useQuery(undefined, { retry: false });
  const [overrides, setOverrides] = useState<Record<ExtractionStage, ModelSelection | null>>({
    transcription: null,
    interpretation: null,
  });
  const [rereadImages, setRereadImages] = useState(false);
  const [text, setText] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const retry = useRef<{ signature: string; message: ChatInput['message'] } | null>(null);
  const transcriptionSelection = id
    ? (history.data?.stageOverrides?.transcription ?? history.data?.override ?? null)
    : overrides.transcription;
  const interpretationSelection = id
    ? (history.data?.stageOverrides?.interpretation ?? null)
    : overrides.interpretation;
  const transcriptionResolution = useFeatureModel(
    'nutrition.productImport',
    transcriptionSelection
  );
  const interpretationResolution = useFeatureModel(
    'nutrition.productInterpretation',
    interpretationSelection
  );
  const busy = disabled || working;
  useEffect(() => {
    onConversation(id);
  }, [id, onConversation]);
  const messages = history.data?.messages ?? [];
  const suggestions = messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (part.type !== 'data-productSuggestion') {
        return [];
      }
      const parsed = productSuggestionSchema.safeParse(part.data);
      return parsed.success ? [{ id: message.id, suggestion: parsed.data }] : [];
    })
  );
  const latest = suggestions.at(-1);
  const historyImages = messages.some((message) =>
    message.parts.some((part) => part.type === 'data-attachment')
  );
  const ready =
    !id ||
    (!!history.data &&
      !history.error &&
      (!history.data.productId || history.data.productId === productId));
  const locked = busy || !ready || !!history.data?.generating;
  const run = async (operation: () => Promise<void>) => {
    setWorking(true);
    onBusy(true);
    setFailure(null);
    try {
      await operation();
      return true;
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : 'Product AI is unavailable. Retry when ready.'
      );
      return false;
    } finally {
      setWorking(false);
      onBusy(false);
    }
  };
  const submit = (attachmentIds: string[]) =>
    run(async () => {
      let conversationId = id;
      if (!conversationId) {
        conversationId = (
          await create.mutateAsync({
            selection: overrides.transcription,
            stageOverrides: overrides,
          })
        ).id;
        setChosen(conversationId);
      }
      try {
        if (productId) {
          await link.mutateAsync({ id: conversationId, productId });
        }
        const parts: ChatInput['message']['parts'] = [
          {
            type: 'text',
            text: text.trim() || 'Extract the packaged product from these photographs.',
          },
          ...attachmentIds.map((attachmentId) => ({
            type: 'data-attachment' as const,
            data: { attachmentId },
          })),
        ];
        const signature = JSON.stringify([
          conversationId,
          parts,
          transcriptionResolution.selection,
          interpretationResolution.selection,
          rereadImages,
        ]);
        if (retry.current?.signature !== signature) {
          retry.current = { signature, message: { id: createClientId(), role: 'user', parts } };
        }
        await extract.mutateAsync({
          conversationId,
          message: retry.current!.message,
          rereadImages,
        });
        retry.current = null;
        setText('');
        setRereadImages(false);
      } finally {
        // A first history fetch may have observed the active lease. Refresh on failures too,
        // so a released generation does not leave retries or model changes locked.
        const refreshed = await Promise.allSettled([
          utils.nutrition.productChat.getConversation.invalidate({ id: conversationId }),
          list.refetch(),
        ]);
        if (refreshed.some((result) => result.status === 'rejected')) {
          setFailure(
            'AI history could not be refreshed. Reload AI history and models to recover the saved conversation.'
          );
        }
      }
    });
  const selectModel = (stage: ExtractionStage, selection: ModelSelection | null) => {
    void run(async () => {
      if (id) {
        await changeModel.mutateAsync({ id, stage, selection });
        await history.refetch();
      } else {
        setOverrides((current) => ({ ...current, [stage]: selection }));
      }
    });
  };
  return (
    <Paper withBorder p="sm" radius="md" mb="lg">
      <Stack gap="sm">
        <Text fw={600}>Import from packaging photos</Text>
        <Text size="sm" c="dimmed">
          Take the front and nutrition table, then add more photos if needed. Review suggestions
          before applying and saving. Sent conversations survive closing; unsaved form edits and
          unsent uploads do not survive reload.
        </Text>
        <Select
          label={productId ? 'Product conversation' : 'Resume an unsaved conversation'}
          value={id}
          disabled={busy}
          placeholder="Start a new conversation by sending a message"
          data={(productId
            ? (linked.data ?? [])
            : (list.data?.filter((item) => !item.productId) ?? [])
          ).map((item) => ({ value: item.id, label: item.title || 'Untitled product import' }))}
          onChange={(next) => {
            setChosen(next);
            setFailure(null);
            setRereadImages(false);
            retry.current = null;
          }}
        />
        <AiPromptComposer
          value={text}
          onChange={setText}
          onSubmit={submit}
          allowImages
          hasImageHistory={historyImages}
          submitting={working}
          submitLabel="Extract suggestions"
          sendShortcut="shift-enter"
          submitDisabled={
            locked || !transcriptionResolution.selection || !interpretationResolution.selection
          }
          textareaProps={{
            disabled: busy,
            label: 'Product prompt or correction',
            placeholder: 'Extract this product, or correct a previous result…',
          }}
          imageStageId="transcription"
          modelPickers={[
            {
              id: 'transcription',
              label: 'Vision transcription',
              help: 'Reads photographs into source evidence. Default follows your AI settings.',
              requiredCapabilities: ['chat', 'vision'],
              models: models.data ?? [],
              modelsLoading: models.isFetching,
              override: transcriptionSelection,
              resolution: transcriptionResolution,
              disabled: locked,
              onChange: (next) => selectModel('transcription', next),
            },
            {
              id: 'interpretation',
              label: 'Text interpretation',
              help: 'Maps source evidence to product suggestions. Does not need vision capability.',
              requiredCapabilities: ['chat'],
              models: models.data ?? [],
              modelsLoading: models.isFetching,
              override: interpretationSelection,
              resolution: interpretationResolution,
              disabled: locked,
              onChange: (next) => selectModel('interpretation', next),
            },
          ]}
        />
        <Checkbox
          label="Read photographs again"
          description="Reuse validated source evidence for follow-ups and interpretation retries unless you request a fresh visual reading. New or changed photographs are always read again."
          checked={rereadImages}
          disabled={locked}
          onChange={(event) => setRereadImages(event.currentTarget.checked)}
        />
        {(failure || history.error || list.error || linked.error || models.error) && (
          <Alert color="red" title="Product AI unavailable">
            {failure ??
              history.error?.message ??
              list.error?.message ??
              linked.error?.message ??
              models.error?.message}
            <Button
              type="button"
              variant="subtle"
              onClick={() => {
                void history.refetch();
                void list.refetch();
                void models.refetch();
                if (productId) {
                  void linked.refetch();
                }
              }}
            >
              Reload AI history and models
            </Button>
          </Alert>
        )}
        {!failure && history.data?.lastStageFailure && (
          <Alert color="red" title={`${history.data.lastStageFailure.label} failed`}>
            {history.data.lastStageFailure.message}
          </Alert>
        )}
        {history.data?.generating && (
          <Alert color="yellow">
            A response is still running. Reload history after it finishes.
          </Alert>
        )}
        {!!messages.length && (
          <details>
            <summary>Conversation and photographs ({messages.length} messages)</summary>
            <Stack gap="sm" mah={360} style={{ overflowY: 'auto' }}>
              {messages.map((message) => (
                <Stack gap={4} key={message.id}>
                  <Text size="xs" fw={600}>
                    {message.role}
                  </Text>
                  {message.parts.map((part, index) =>
                    part.type === 'text' ? (
                      <Text size="sm" key={index} style={{ whiteSpace: 'pre-wrap' }}>
                        {part.text}
                      </Text>
                    ) : part.type === 'data-attachment' ? (
                      <Group key={index}>
                        <AttachmentImage
                          attachmentId={(part.data as { attachmentId: string }).attachmentId}
                        />
                      </Group>
                    ) : null
                  )}
                </Stack>
              ))}
            </Stack>
          </details>
        )}
        {latest && (
          <ProductSuggestionReview
            key={latest.id}
            suggestion={latest.suggestion}
            value={value}
            touched={touched}
            onApply={onApply}
            disabled={locked}
          />
        )}
      </Stack>
    </Paper>
  );
}
