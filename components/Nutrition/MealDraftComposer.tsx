'use client';

import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import type { MealDraft } from '@/lib/nutrition/drafts';
import { mealLabels } from '@/lib/nutrition/types';
import { MealDraftReview } from './MealDraftReview';

export function MealDraftComposer({
  date,
  initialDraftId,
  onConfirmed,
}: {
  date: string;
  initialDraftId?: string;
  onConfirmed: (date: string) => Promise<void>;
}) {
  const utils = trpc.useUtils();
  const [opened, setOpened] = useState(Boolean(initialDraftId));
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const creationId = useRef<string | null>(null);
  const viewRevision = useRef(0);
  const pendingTurn = useRef<{ draftId: string; text: string; requestId: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const list = trpc.nutrition.listDrafts.useQuery(undefined, {
    retry: false,
    refetchOnMount: 'always',
  });
  const models = trpc.nutrition.draftModels.useQuery(undefined, {
    enabled: opened && !draftId,
    retry: false,
  });
  const interpret = trpc.nutrition.interpretDraft.useMutation({ retry: false, gcTime: 0 });
  const draft = trpc.nutrition.getDraft.useQuery(
    { id: draftId ?? '' },
    {
      enabled: opened && Boolean(draftId),
      retry: false,
      refetchOnMount: 'always',
      refetchInterval: (query) =>
        interpret.isPending || query.state.data?.generating ? 2000 : false,
    }
  );
  const current =
    opened && draftId && draft.isFetchedAfterMount && !draft.error ? draft.data : undefined;
  const create = trpc.nutrition.createDraft.useMutation({ retry: false });
  const setLocation = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set('draft', id);
    } else {
      url.searchParams.delete('draft');
    }
    window.history.replaceState(null, '', url);
  };
  const close = () => {
    viewRevision.current += 1;
    setOpened(false);
    setLocation(null);
  };
  const saved = async (value: MealDraft) => {
    utils.nutrition.getDraft.setData({ id: value.id }, value);
    await utils.nutrition.listDrafts.invalidate();
  };
  const send = async (message: string, retryRequestId?: string) => {
    if (!message.trim() || interpret.isPending || create.isPending) {
      return;
    }
    setSendError(null);
    const requestViewRevision = viewRevision.current;
    let active = current;
    try {
      if (!active) {
        if (draftId) {
          setSendError('Reload the saved draft before sending another message.');
          return;
        }
        if (!modelId) {
          setSendError('Choose an installed chat model.');
          return;
        }
        creationId.current ??= crypto.randomUUID();
        active = await create.mutateAsync({
          id: creationId.current,
          date,
          mealCategory: 'SNACKS',
          selection: { provider: 'ollama', modelId },
        });
        await saved(active);
        if (requestViewRevision === viewRevision.current) {
          setDraftId(active.id);
          setLocation(active.id);
        }
      }
      await utils.nutrition.listDrafts.invalidate();
      const requestId =
        retryRequestId ??
        (pendingTurn.current?.draftId === active.id && pendingTurn.current.text === message.trim()
          ? pendingTurn.current.requestId
          : crypto.randomUUID());
      pendingTurn.current = { draftId: active.id, text: message.trim(), requestId };
      const result = await interpret.mutateAsync({
        id: active.id,
        revision: active.revision,
        requestId,
        text: message,
      });
      await saved(result);
      pendingTurn.current = null;
      if (requestViewRevision === viewRevision.current) {
        setText('');
      }
    } catch {
      if (active) {
        await utils.nutrition.getDraft.invalidate({ id: active.id });
        await utils.nutrition.listDrafts.invalidate();
      }
    }
  };
  return (
    <>
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <div>
            <Title order={3}>Describe what you ate</Title>
            <Text size="sm" c="dimmed">
              Turn a description into a saved draft, then review it before logging.
            </Text>
          </div>
          <Group>
            <Button
              onClick={() => {
                viewRevision.current += 1;
                setNotice(null);
                setDraftId(null);
                setText('');
                creationId.current = null;
                create.reset();
                interpret.reset();
                setSendError(null);
                setOpened(true);
                setLocation(null);
              }}
            >
              Describe a meal
            </Button>
          </Group>
          {list.error && (
            <Alert color="red">
              <Text>{list.error.message}</Text>
              <Button variant="subtle" onClick={() => void list.refetch()}>
                Retry loading meal drafts
              </Button>
            </Alert>
          )}
          {list.isFetchedAfterMount && list.data && list.data.length > 0 && (
            <Select
              label="Resume a saved meal draft"
              placeholder="Choose an unfinished draft"
              value={null}
              data={list.data.map((entry) => ({
                value: entry.id,
                label: `${entry.logDate.toISOString().slice(0, 10)} · ${mealLabels[entry.mealCategory]} · ${entry.title}`,
              }))}
              onChange={(id) => {
                if (id) {
                  viewRevision.current += 1;
                  setNotice(null);
                  setDraftId(id);
                  setText('');
                  interpret.reset();
                  setSendError(null);
                  setOpened(true);
                  setLocation(id);
                }
              }}
            />
          )}
        </Stack>
      </Paper>
      <Modal
        opened={opened}
        onClose={close}
        title="Meal draft"
        size="xl"
        closeOnClickOutside={false}
      >
        <Stack gap="lg">
          {draft.error && draftId && (
            <Alert color="red">
              <Text>{draft.error.message}</Text>
              <Button variant="subtle" onClick={() => void draft.refetch()}>
                Reload draft
              </Button>
            </Alert>
          )}
          {draftId && !current && !draft.error && (
            <Text role="status">Loading saved meal draft…</Text>
          )}
          {!draftId && (
            <>
              <Text>
                Describe foods and amounts. Missing foods, ambiguous matches and unknown conversions
                remain yours to resolve.
              </Text>
              <Select
                label="Chat model"
                placeholder={models.isLoading ? 'Loading models…' : 'Choose an installed model'}
                value={modelId}
                onChange={setModelId}
                data={(models.data ?? []).map((model) => ({ value: model.id, label: model.id }))}
              />
              {models.error && (
                <Alert color="red">
                  <Text>{models.error.message}</Text>
                  <Button variant="subtle" onClick={() => void models.refetch()}>
                    Retry loading chat models
                  </Button>
                </Alert>
              )}
            </>
          )}
          {current && (
            <>
              <MealDraftReview
                key={current.revision}
                draft={current}
                onSaved={saved}
                onClosed={close}
                onConfirmed={async (targetDate) => {
                  await utils.nutrition.listDrafts.invalidate();
                  await onConfirmed(targetDate);
                }}
                onNotice={setNotice}
              />
              {notice && <Alert color="yellow">{notice}</Alert>}
              <Text size="xs" c="dimmed">
                Interpretation model: {current.selection.modelId}
              </Text>
              {current.turns.map((turn) => (
                <Paper key={turn.id} withBorder p="sm" radius="sm">
                  <Stack gap="xs">
                    <Text size="sm" fw={600}>
                      You
                    </Text>
                    <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {turn.userText}
                    </Text>
                    {turn.assistantText && (
                      <>
                        <Text size="sm" fw={600}>
                          Vela
                        </Text>
                        <Text
                          size="sm"
                          style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                        >
                          {turn.assistantText}
                        </Text>
                      </>
                    )}
                    {turn.error && (
                      <Text size="sm" c="dimmed">
                        {turn.error}
                      </Text>
                    )}
                    {turn.status === 'FAILED' && current.status === 'DRAFT' && (
                      <Group>
                        <Button
                          size="xs"
                          variant="light"
                          disabled={interpret.isPending || current.generating}
                          onClick={() => void send(turn.userText, turn.id)}
                        >
                          Retry this message
                        </Button>
                      </Group>
                    )}
                  </Stack>
                </Paper>
              ))}
            </>
          )}
          {(!current || current.status === 'DRAFT') && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send(text);
              }}
            >
              <Stack gap="sm">
                <Textarea
                  label={current ? 'Correct or extend this meal' : 'What did you eat?'}
                  placeholder="For lunch I had 200 grams of rice and 150 grams of chicken."
                  autosize
                  minRows={3}
                  maxRows={8}
                  maxLength={4000}
                  value={text}
                  onChange={(event) => setText(event.currentTarget.value)}
                />
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    Saved drafts survive closing and reloading this page.
                  </Text>
                  <Button
                    type="submit"
                    loading={interpret.isPending || create.isPending}
                    disabled={
                      !text.trim() ||
                      Boolean(current?.generating) ||
                      (!draftId && !modelId) ||
                      Boolean(draftId && !current)
                    }
                  >
                    {current ? 'Update meal draft' : 'Create meal draft'}
                  </Button>
                </Group>
              </Stack>
            </form>
          )}
          {(interpret.isPending || current?.generating) && (
            <Text role="status" size="sm">
              Interpreting your message…
            </Text>
          )}
          {(sendError || create.error || interpret.error) && (
            <Alert color="red">
              {sendError ?? create.error?.message ?? interpret.error?.message}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              Close draft
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
