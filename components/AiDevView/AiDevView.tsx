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
  Textarea,
  Title,
} from '@mantine/core';
import { IconMessagePlus, IconRefresh, IconSend, IconPlayerStop } from '@tabler/icons-react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useRef, useState } from 'react';
import type { AiModelSelection } from '@/lib/ai';
import { maxMessageLength } from '@/lib/ai-dev/schema';
import { trpc } from '@/lib/trpc/client';
import classes from './AiDevView.module.css';

export function AiDevView() {
  const models = trpc.aiDev.listChatModels.useQuery(undefined, { retry: false });
  const [modelId, setModelId] = useState<string | null>(null);
  const [conversation, setConversation] = useState(0);
  const selection = models.data?.find((model) => model.id === modelId);

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <div>
          <Title order={2}>AI Dev</Title>
          <Text c="dimmed" mt={4}>
            Chat with an installed model.
          </Text>
        </div>

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

        <ChatPanel
          key={conversation}
          selection={selection ? { provider: selection.provider, modelId: selection.id } : null}
          modelPicker={(busy) => (
            <Group align="flex-end">
              <Select
                className={classes.modelPicker}
                label="Chat model"
                placeholder="Choose a chat model"
                searchable
                allowDeselect={false}
                data={models.data?.map((model) => ({ value: model.id, label: model.id })) ?? []}
                value={modelId}
                onChange={setModelId}
                disabled={busy || models.isPending || Boolean(models.error)}
                error={
                  modelId && !selection && models.isSuccess
                    ? 'Choose an available chat model.'
                    : undefined
                }
              />
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                loading={models.isFetching}
                disabled={busy}
                onClick={() => void models.refetch()}
              >
                Refresh models
              </Button>
            </Group>
          )}
          onNewConversation={() => setConversation((value) => value + 1)}
        />
      </Stack>
    </Container>
  );
}

type ChatPanelProps = {
  selection: AiModelSelection | null;
  modelPicker: (busy: boolean) => React.ReactNode;
  onNewConversation: () => void;
};

function ChatPanel({ selection, modelPicker, onNewConversation }: ChatPanelProps) {
  const [transport] = useState(() => new DefaultChatTransport({ api: '/api/ai-dev/chat' }));
  const { messages, sendMessage, regenerate, status, error, stop } = useChat({ transport });
  const [input, setInput] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const followResponse = useRef(true);
  const busy = status === 'submitted' || status === 'streaming';

  useEffect(
    () => () => {
      void stop();
    },
    [stop]
  );
  useEffect(() => {
    if (followResponse.current && viewport.current) {
      viewport.current.scrollTo({ top: viewport.current.scrollHeight });
    }
  }, [messages, status]);

  const submit = () => {
    if (!selection || !input.trim() || busy || error) {
      return;
    }
    followResponse.current = true;
    void sendMessage({ text: input.trim() }, { body: { selection } });
    setInput('');
  };

  return (
    <Stack gap="md">
      {modelPicker(busy)}
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Conversations clear when you leave or reload this page.
        </Text>
        <Button
          variant="light"
          leftSection={<IconMessagePlus size={16} />}
          onClick={async () => {
            await stop();
            onNewConversation();
          }}
        >
          New conversation
        </Button>
      </Group>

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
                <Stack gap="xs" align="center">
                  <Title order={4}>Start a conversation</Title>
                  <Text size="sm" c="dimmed">
                    Choose a model and send your first message.
                  </Text>
                </Stack>
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
                {message.parts.map((part, index) =>
                  part.type === 'text' ? (
                    <Text key={`${message.id}-${index}`} className={classes.messageText}>
                      {part.text}
                    </Text>
                  ) : null
                )}
              </Paper>
            ))}
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

      {error && (
        <Alert color="red" title="Could not complete the response">
          <Stack gap="sm">
            <Text size="sm">{error.message}</Text>
            <Button
              variant="light"
              size="compact-sm"
              disabled={!selection || busy}
              onClick={() => {
                if (selection) {
                  void regenerate({ body: { selection } });
                }
              }}
            >
              Retry response
            </Button>
          </Stack>
        </Alert>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Stack gap="sm">
          <Textarea
            label="Message"
            placeholder="Write a message…"
            autosize
            minRows={2}
            maxRows={8}
            maxLength={maxMessageLength}
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            disabled={!selection || busy || Boolean(error)}
          />
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Enter to send · Shift+Enter for a new line
            </Text>
            {busy ? (
              <Button
                variant="default"
                leftSection={<IconPlayerStop size={16} />}
                onClick={() => void stop()}
              >
                Stop response
              </Button>
            ) : (
              <Button
                type="submit"
                leftSection={<IconSend size={16} />}
                disabled={!selection || !input.trim() || Boolean(error)}
              >
                Send
              </Button>
            )}
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
