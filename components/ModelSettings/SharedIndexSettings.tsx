'use client';

import { useState } from 'react';
import { Alert, Button, Group, Paper, Select, Stack, Text, Textarea, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { trpc } from '@/lib/trpc/client';
import type { EmbeddingConfiguration } from '@/lib/embeddings/types';
import type { ModelSelection } from '@/lib/model-settings/schema';

type IndexStatus = {
  configuration: EmbeddingConfiguration | null;
  isMaintainer: boolean;
  busy: boolean;
  indexed: number;
  total: number;
  lastError: string | null;
};

export function TaskIndexSettings() {
  const utils = trpc.useUtils();
  const status = trpc.taskSearch.status.useQuery(undefined, {
    retry: false,
    refetchOnMount: 'always',
    refetchInterval: (query) => (query.state.data?.busy ? 2000 : false),
  });
  const rebuild = trpc.taskSearch.rebuild.useMutation({
    retry: false,
    onSettled: async () => {
      await utils.taskSearch.invalidate();
    },
  });
  return (
    <IndexSettings
      title="Planner · Task search"
      initialInstruction="Find tasks relevant to the search query."
      status={status.isFetchedAfterMount && !status.error ? status.data : undefined}
      error={status.error?.message}
      refresh={() => void status.refetch()}
      pending={rebuild.isPending}
      failure={rebuild.error?.message}
      success={rebuild.isSuccess}
      rebuild={(selection, queryInstruction) => rebuild.mutate({ selection, queryInstruction })}
    />
  );
}

export function FoodIndexSettings() {
  const utils = trpc.useUtils();
  const status = trpc.nutrition.productIndexStatus.useQuery(undefined, {
    retry: false,
    refetchOnMount: 'always',
    refetchInterval: (query) => (query.state.data?.busy ? 2000 : false),
  });
  const rebuild = trpc.nutrition.rebuildProductIndex.useMutation({
    retry: false,
    onSettled: async () => {
      await utils.nutrition.invalidate();
    },
  });
  return (
    <IndexSettings
      title="Nutrition · Related-food search"
      initialInstruction="Find foods and food products relevant to the search query."
      status={status.isFetchedAfterMount && !status.error ? status.data : undefined}
      error={status.error?.message}
      refresh={() => void status.refetch()}
      pending={rebuild.isPending}
      failure={rebuild.error?.message}
      success={rebuild.isSuccess}
      rebuild={(selection, queryInstruction) => rebuild.mutate({ selection, queryInstruction })}
    />
  );
}

function IndexSettings({
  title,
  initialInstruction,
  status,
  error,
  refresh,
  pending,
  failure,
  success,
  rebuild,
}: {
  title: string;
  initialInstruction: string;
  status?: IndexStatus;
  error?: string;
  refresh: () => void;
  pending: boolean;
  failure?: string;
  success: boolean;
  rebuild: (selection: ModelSelection, instruction: string) => void;
}) {
  const models = trpc.settings.listAiModels.useQuery(undefined, {
    enabled: Boolean(status?.isMaintainer),
    retry: false,
  });
  const defaults = trpc.settings.getAiModels.useQuery(undefined, {
    enabled: Boolean(status?.isMaintainer),
    retry: false,
    refetchOnMount: 'always',
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const [instruction, setInstruction] = useState<string | null>(null);
  const defaultChoice =
    defaults.isFetchedAfterMount && !defaults.error
      ? defaults.data?.settings.embeddings
      : undefined;
  const defaultId = defaultChoice && 'modelId' in defaultChoice ? defaultChoice.modelId : null;
  const modelId = chosen ?? status?.configuration?.modelId ?? defaultId;
  const queryInstruction =
    instruction ??
    (status?.configuration
      ? status.configuration.queryPrefix.startsWith('Instruct: ')
        ? status.configuration.queryPrefix.slice(10).replace(/\nQuery: $/, '')
        : ''
      : initialInstruction);
  const busy = pending || status?.busy;
  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Title order={4}>{title}</Title>
        <Text size="sm" c="dimmed">
          The published search model stays fixed until a maintainer rebuilds the shared index.
          Changing your AI defaults does not change this index.
        </Text>
        {error && <Alert color="red">{error}</Alert>}
        {!status && !error && <Text role="status">Loading index…</Text>}
        {status && (
          <>
            <Text size="sm">
              {status.configuration
                ? `${status.configuration.modelId} · ${status.configuration.dimensions} dimensions · ${status.indexed} of ${status.total} items current`
                : 'No published index configuration.'}
            </Text>
            {status.lastError && <Alert color="yellow">{status.lastError}</Alert>}
            {!status.isMaintainer && (
              <Text size="sm" c="dimmed">
                A search maintainer manages the shared model and rebuilds.
              </Text>
            )}
            {status.isMaintainer && (
              <>
                {models.error && <Alert color="red">{models.error.message}</Alert>}
                <Select
                  label={`${title} model`}
                  searchable
                  value={modelId}
                  onChange={setChosen}
                  data={(models.data ?? [])
                    .filter((model) => model.capabilities.includes('embedding'))
                    .map((model) => ({ value: model.id, label: model.id }))}
                  disabled={busy || models.isPending || Boolean(models.error)}
                />
                {defaultId && (
                  <Button variant="subtle" disabled={busy} onClick={() => setChosen(defaultId)}>
                    Use my Embeddings default ({defaultId})
                  </Button>
                )}
                <Textarea
                  label={`${title} query instruction`}
                  value={queryInstruction}
                  maxLength={1000}
                  disabled={busy}
                  description="Leave empty for raw search text. Changing this requires a complete rebuild."
                  onChange={(event) => setInstruction(event.currentTarget.value)}
                />
                <Button
                  loading={pending}
                  disabled={
                    busy ||
                    !modelId ||
                    Boolean(models.error) ||
                    !models.data?.some(
                      (model) => model.id === modelId && model.capabilities.includes('embedding')
                    )
                  }
                  onClick={() => {
                    if (modelId) {
                      modals.openConfirmModal({
                        title: `Rebuild ${title}?`,
                        children: (
                          <Text>
                            This rebuilds the shared index for every user with {modelId}. The
                            current index stays active until the replacement is ready.
                          </Text>
                        ),
                        labels: { confirm: 'Rebuild shared index', cancel: 'Cancel' },
                        onConfirm: () =>
                          rebuild({ provider: 'ollama', modelId }, queryInstruction.trim()),
                      });
                    }
                  }}
                >
                  Rebuild shared index
                </Button>
              </>
            )}
          </>
        )}
        <Group>
          <Button variant="default" onClick={refresh}>
            Refresh index status
          </Button>
        </Group>
        {failure && <Alert color="red">{failure}</Alert>}
        {success && <Text role="status">Index rebuilt successfully.</Text>}
      </Stack>
    </Paper>
  );
}
