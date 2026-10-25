'use client';

import { useChat } from '@ai-sdk/react';
import {
  Alert,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconMessagePlus, IconRefresh, IconTrash } from '@tabler/icons-react';
import type { inferRouterOutputs } from '@trpc/server';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePlanningWorkspaceStore } from '@/store/planningWorkspaceStore';
import { PlannerDebug } from '../PlannerChat/PlannerDebug';
import { RecordResult } from '../PlannerChat/RecordResult';
import { PlanningResult } from '../PlannerChat/PlanningResult';
import { BasicMarkdown } from './BasicMarkdown';
import { maxMessageLength } from '@/lib/ai-dev/schema';
import { trpc } from '@/lib/trpc/client';
import type { AppRouter } from '@/lib/trpc/root';
import type { AiModel } from '@/lib/ai';
import classes from './AiDevView.module.css';
import { useFeatureModel } from '@/components/ModelSettings/FeatureModelSelect';
import { ModelPicker } from '@/components/AiPromptComposer/ModelPicker';
import { AiPromptComposer } from '@/components/AiPromptComposer/AiPromptComposer';

type SavedConversation = inferRouterOutputs<AppRouter>['aiDev']['getConversation'];

export function ConversationChat({
  plannerDate,
  children,
}: { plannerDate?: string; children?: ReactNode } = {}) {
  const planner = plannerDate !== undefined;
  const api = planner ? trpc.plannerChat : trpc.aiDev;
  const feature = planner ? 'planner.conversation' : 'aiDev.chat';
  const allUtils = trpc.useUtils();
  const utils = planner ? allUtils.plannerChat : allUtils.aiDev;
  const models = api.listChatModels.useQuery(undefined, { retry: false });
  const conversations = api.listConversations.useQuery(undefined, {
    retry: false,
    refetchOnMount: 'always',
  });
  const [modelId, setModelId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const detail = api.getConversation.useQuery(
    { id: conversationId! },
    {
      enabled: Boolean(conversationId),
      retry: false,
      refetchOnMount: 'always',
      refetchOnWindowFocus: false,
      refetchInterval: (query) => (query.state.data?.generating ? 2000 : false),
    }
  );
  const [mutationError, setMutationError] = useState<string | null>(null);
  const create = api.createConversation.useMutation({
    onSuccess: async ({ id }) => {
      setConversationId(id);
      await utils.listConversations.invalidate();
    },
    onError: (error) => setMutationError(error.message),
  });
  const remove = api.deleteConversation.useMutation({
    onSuccess: async () => {
      setConversationId(null);
      await utils.listConversations.invalidate();
    },
    onError: (error) => setMutationError(error.message),
  });
  // Do not render another session's cached data before a fresh authorized read.
  const saved =
    conversations.isFetchedAfterMount && !conversations.error ? (conversations.data ?? []) : [];
  const restored = useRef(false);
  useEffect(() => {
    if (planner && conversations.isFetchedAfterMount && !conversations.error && !restored.current) {
      restored.current = true;
      setConversationId(conversations.data?.[0]?.id ?? null);
    }
  }, [planner, conversations.isFetchedAfterMount, conversations.error, conversations.data]);
  const current = detail.isFetchedAfterMount && !detail.error ? detail.data : undefined;
  const override = modelId ? { provider: 'ollama' as const, modelId } : null;
  const resolution = useFeatureModel(feature, override, !conversationId);
  const selection = resolution.selection;
  const refresh = () => {
    void utils.listConversations.invalidate();
    if (conversationId) {
      void utils.getConversation.invalidate({ id: conversationId });
    }
  };

  return (
    <Container fluid={planner} size="lg" py={planner ? 'xs' : 'xl'} px={planner ? 'xs' : undefined}>
      <Stack gap="lg">
        <div>
          <Title order={planner ? 4 : 2}>{planner ? 'Planner chat' : 'AI Dev'}</Title>
          <Text c="dimmed" mt={4}>
            {planner
              ? `Planning ${plannerDate}. Conversations are saved to your account.`
              : 'Chat with an installed model. Conversations are saved to your account.'}
          </Text>
        </div>
        {children}
        <Group align="flex-end">
          <Select
            className={classes.modelPicker}
            label="Saved conversations"
            placeholder="Open a conversation"
            searchable
            data={saved.map((conversation) => ({
              value: conversation.id,
              label: `${conversation.title} · ${conversation.inheritsModel ? 'Use settings' : conversation.modelId}`,
            }))}
            value={conversationId}
            onChange={(id) => {
              setMutationError(null);
              setConversationId(id);
            }}
            disabled={
              !conversations.isFetchedAfterMount ||
              Boolean(conversations.error) ||
              create.isPending ||
              remove.isPending
            }
          />
          <Button
            variant="light"
            leftSection={<IconMessagePlus size={16} />}
            onClick={() => {
              setModelId(null);
              setConversationId(null);
              setMutationError(null);
            }}
          >
            New conversation
          </Button>
          <Button
            variant="default"
            color="red"
            leftSection={<IconTrash size={16} />}
            disabled={!current}
            loading={remove.isPending}
            onClick={() => {
              if (!current) {
                return;
              }
              modals.openConfirmModal({
                title: 'Delete conversation',
                children: <Text>Delete this conversation and all its messages?</Text>,
                labels: { confirm: 'Delete', cancel: 'Cancel' },
                confirmProps: { color: 'red' },
                onConfirm: () => {
                  setMutationError(null);
                  remove.mutate({ id: current.id });
                },
              });
            }}
          >
            Delete
          </Button>
        </Group>
        {conversations.error && (
          <Alert color="red" title="Could not load conversations">
            <Text size="sm">{conversations.error.message}</Text>
            <Button variant="light" size="compact-sm" onClick={() => void conversations.refetch()}>
              Retry loading conversations
            </Button>
          </Alert>
        )}
        {mutationError && <Alert color="red">{mutationError}</Alert>}
        {models.isPending && (
          <Group role="status">
            <Loader size="sm" />
            <Text>Loading chat models…</Text>
          </Group>
        )}
        {models.error && (
          <Alert color="red" title="Could not load models">
            <Stack gap="sm">
              <Text size="sm">{models.error.message}</Text>
              <Button variant="light" size="compact-sm" onClick={() => void models.refetch()}>
                Retry loading models
              </Button>
            </Stack>
          </Alert>
        )}
        {models.isSuccess && models.data.length === 0 && (
          <Alert color="yellow">
            No chat models are installed in Ollama. Install one, then refresh.
          </Alert>
        )}
        {!conversationId && (
          <Group align="flex-end">
            <ModelPicker
              override={override}
              onChange={(value) => setModelId(value?.modelId ?? null)}
              models={models.data ?? []}
              resolution={resolution}
              disabled={create.isPending}
            />
            <Button
              variant="default"
              leftSection={<IconRefresh size={16} />}
              loading={models.isFetching}
              onClick={() => void models.refetch()}
            >
              Refresh models
            </Button>
          </Group>
        )}
        {!conversationId && resolution.error && (
          <Alert color="red">{resolution.error.message}</Alert>
        )}
        {!conversationId ? (
          <Paper withBorder p="xl" radius="md">
            <Center className={classes.empty}>
              <Stack align="center" gap="sm">
                <Title order={4}>Start a conversation</Title>
                <Text size="sm" c="dimmed">
                  Your settings choose the model. You can override it for this conversation.
                </Text>
                <Button
                  disabled={!selection || Boolean(models.error)}
                  loading={create.isPending}
                  onClick={() => {
                    if (selection) {
                      setMutationError(null);
                      create.mutate({ selection: override });
                    }
                  }}
                >
                  Start conversation
                </Button>
              </Stack>
            </Center>
          </Paper>
        ) : detail.error ? (
          <Alert color="red" title="Could not open conversation">
            <Text>{detail.error.message}</Text>
            <Button variant="light" onClick={() => void detail.refetch()}>
              Retry opening conversation
            </Button>
          </Alert>
        ) : !current ? (
          <Group role="status">
            <Loader size="sm" />
            <Text>Loading conversation…</Text>
          </Group>
        ) : (
          <ChatPanel
            key={current.id}
            conversation={current}
            onSaved={refresh}
            models={models.data ?? []}
            plannerDate={plannerDate}
          />
        )}
      </Stack>
    </Container>
  );
}

function ChatPanel({
  conversation,
  onSaved,
  models,
  plannerDate,
}: {
  conversation: SavedConversation;
  onSaved: () => void;
  models: AiModel[];
  plannerDate?: string;
}) {
  const planner = plannerDate !== undefined;
  const api = planner ? trpc.plannerChat : trpc.aiDev;
  const feature = planner ? 'planner.conversation' : 'aiDev.chat';
  const dateRef = useRef(plannerDate);
  dateRef.current = plannerDate;
  const allUtils = trpc.useUtils();
  const utils = planner ? allUtils.plannerChat : allUtils.aiDev;
  const resolution = useFeatureModel(feature, conversation.override);
  const changeModel = api.changeConversationModel.useMutation({
    onSuccess: async () => {
      await utils.getConversation.invalidate({ id: conversation.id });
      onSaved();
    },
  });
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: planner ? '/api/planner/chat' : '/api/ai-dev/chat',
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: {
            conversationId: id,
            ...(dateRef.current
              ? {
                  date: dateRef.current,
                  proposalId:
                    usePlanningWorkspaceStore.getState().preview?.date === dateRef.current
                      ? usePlanningWorkspaceStore.getState().preview?.id
                      : null,
                  focusedBlockId: usePlanningWorkspaceStore.getState().focusedBlockId,
                  focusedTaskId: usePlanningWorkspaceStore.getState().focusedTaskId,
                }
              : {}),
            message: messages.filter((message) => message.role === 'user').at(-1),
          },
        }),
      })
  );
  const { messages, sendMessage, regenerate, setMessages, status, error, stop } = useChat({
    id: conversation.id,
    messages: conversation.messages,
    transport,
    onFinish: onSaved,
    onError: onSaved,
  });
  const [input, setInput] = useState('');
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const revise = () => {
    setInput('Revise the pending proposal: ');
    messageInput.current?.focus();
  };
  const viewport = useRef<HTMLDivElement>(null);
  const followResponse = useRef(true);
  const loadedVersion = useRef(conversation.updatedAt.getTime());
  useEffect(() => {
    if (planner) {
      usePlanningWorkspaceStore.getState().showPreview(null);
    }
  }, [conversation.id, planner]);
  const busy = status === 'submitted' || status === 'streaming';
  const generatingElsewhere = conversation.generating && !busy;
  const incomplete =
    conversation.lastResponseStatus === 'INTERRUPTED' ||
    conversation.lastResponseStatus === 'FAILED';
  useEffect(
    () => () => {
      void stop();
    },
    [stop]
  );
  useEffect(() => {
    if (
      !busy &&
      !error &&
      !conversation.generating &&
      loadedVersion.current !== conversation.updatedAt.getTime()
    ) {
      setMessages(conversation.messages);
      loadedVersion.current = conversation.updatedAt.getTime();
    }
  }, [busy, error, conversation, setMessages]);
  useEffect(() => {
    if (followResponse.current && viewport.current) {
      viewport.current.scrollTo({ top: viewport.current.scrollHeight });
    }
  }, [messages, status]);
  const submit = () => {
    if (
      !input.trim() ||
      busy ||
      error ||
      generatingElsewhere ||
      changeModel.isPending ||
      !resolution.selection
    ) {
      return;
    }
    followResponse.current = true;
    void sendMessage({ text: input.trim() });
    setInput('');
  };
  return (
    <Stack gap="md">
      {changeModel.error && <Alert color="red">{changeModel.error.message}</Alert>}
      {generatingElsewhere && (
        <Alert color="blue">
          A response is being generated for this conversation. Saved history will refresh when it
          finishes.
        </Alert>
      )}
      <Paper withBorder p="md" radius="md">
        <ScrollArea
          className={classes.transcript}
          viewportRef={viewport}
          onScrollPositionChange={() => {
            const element = viewport.current;
            if (element) {
              followResponse.current =
                element.scrollHeight - element.scrollTop - element.clientHeight < 80;
            }
          }}
        >
          <Stack gap="md" role="log" aria-label="Conversation" aria-live="polite">
            {messages.length === 0 && (
              <Center className={classes.empty}>
                <Text c="dimmed">Send your first message.</Text>
              </Center>
            )}
            {messages.map((message) => (
              <Paper
                key={message.id}
                component="article"
                aria-label={`${message.role === 'user' ? 'User' : 'Assistant'} message`}
                className={classes.message}
                data-role={message.role}
                p="sm"
              >
                <Text size="sm" fw={600} mb={4}>
                  {message.role === 'user' ? 'You' : 'Assistant'}
                </Text>
                {message.role === 'assistant' &&
                  (message.metadata as { modelId?: string } | undefined)?.modelId && (
                    <Text size="xs" c="dimmed">
                      {(message.metadata as { modelId: string }).modelId}
                    </Text>
                  )}
                {message.parts.map((part, index) =>
                  part.type === 'text' ? (
                    <BasicMarkdown key={`${message.id}-${index}`} text={part.text} />
                  ) : planner && part.type === 'data-planning' ? (
                    <PlanningResult
                      key={`${message.id}-${index}`}
                      value={part.data}
                      onRevise={revise}
                      conversationId={conversation.id}
                      onChoose={(recordId) => setInput(`I mean ${recordId}.`)}
                    />
                  ) : planner && part.type.startsWith('tool-') && 'output' in part ? (
                    <PlanningResult
                      key={`${message.id}-${index}`}
                      value={part.output}
                      onRevise={revise}
                      conversationId={conversation.id}
                      onChoose={(recordId) => setInput(`I mean ${recordId}.`)}
                    />
                  ) : null
                )}
                {planner &&
                  message.role === 'assistant' &&
                  message.parts.map((part, index) =>
                    part.type === 'data-plannerDebug' && 'data' in part ? (
                      <PlannerDebug key={`${message.id}-debug-${index}`} value={part.data} />
                    ) : null
                  )}
                {planner &&
                  !busy &&
                  message.role === 'assistant' &&
                  message.parts.every((part) => part.type === 'step-start') && (
                    <Text size="xs" c="dimmed">
                      No debug details were recorded for this older response. Retry to capture a
                      trace.
                    </Text>
                  )}
              </Paper>
            ))}
            {planner && (
              <PendingRecordRecovery
                conversationId={conversation.id}
                messages={messages}
                onRevise={revise}
              />
            )}
            {busy && (
              <Group gap="xs" role="status">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">
                  {status === 'submitted' ? 'Waiting for a response…' : 'Responding…'}
                </Text>
              </Group>
            )}
          </Stack>
        </ScrollArea>
      </Paper>
      {!busy && (error || incomplete) && (
        <Alert color={error ? 'red' : 'yellow'} title="Response incomplete">
          <Stack gap="sm">
            <Text size="sm">
              {error?.message ??
                'The previous response was interrupted or failed. You can retry it or send another message.'}
            </Text>
            <Button
              variant="light"
              size="compact-sm"
              disabled={generatingElsewhere || changeModel.isPending || !resolution.selection}
              onClick={() => {
                void regenerate();
              }}
            >
              Retry response
            </Button>
          </Stack>
        </Alert>
      )}
      <AiPromptComposer
        inputRef={messageInput}
        value={input}
        onChange={setInput}
        onSubmit={submit}
        modelPicker={{
          override: conversation.override,
          models,
          resolution,
          disabled: busy || generatingElsewhere || changeModel.isPending,
          onChange: (selection) => changeModel.mutate({ id: conversation.id, selection }),
        }}
        textareaProps={{
          maxLength: planner ? 2000 : maxMessageLength,
          disabled: busy || Boolean(error) || generatingElsewhere || changeModel.isPending,
        }}
        submitDisabled={
          Boolean(error) || generatingElsewhere || changeModel.isPending || !resolution.selection
        }
        submitting={busy}
        onStop={() => void stop()}
      />
    </Stack>
  );
}

export function AiDevView() {
  return <ConversationChat />;
}

function PendingRecordRecovery({
  conversationId,
  messages,
  onRevise,
}: {
  conversationId: string;
  messages: UIMessage[];
  onRevise: () => void;
}) {
  const pending = trpc.plannerChat.pendingRecordPreview.useQuery(
    { id: conversationId },
    { refetchInterval: 5000 }
  );
  if (pending.error) {
    return (
      <Alert color="red" role="alert">
        {pending.error.message}
      </Alert>
    );
  }
  const row = pending.data;
  if (
    !row ||
    messages.some((message) =>
      message.parts.some((part) => {
        const value =
          part.type === 'data-planning' && 'data' in part
            ? part.data
            : 'output' in part
              ? part.output
              : null;
        return (
          value &&
          typeof value === 'object' &&
          'recordProposalId' in value &&
          value.recordProposalId === row.id
        );
      })
    )
  ) {
    return null;
  }
  return <RecordResult conversationId={conversationId} id={row.id} onRevise={onRevise} />;
}
