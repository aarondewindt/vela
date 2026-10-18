'use client';

import { useState } from 'react';
import { Accordion, Alert, Button, Group, Select, Stack, Text, Textarea } from '@mantine/core';
import { modals } from '@mantine/modals';
import { trpc } from '@/lib/trpc/client';

export function ProductSearchSettings() {
  const utils = trpc.useUtils();
  const status = trpc.nutrition.productIndexStatus.useQuery(undefined, {
    retry: false,
    refetchOnMount: 'always',
    refetchInterval: (query) =>
      query.state.data?.job?.pending || query.state.data?.busy ? 5000 : false,
  });
  const current = status.isFetchedAfterMount && !status.error ? status.data : undefined;
  const models = trpc.nutrition.productEmbeddingModels.useQuery(undefined, {
    enabled: Boolean(current?.isMaintainer),
    retry: false,
  });
  const [modelId, setModelId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState(
    'Find foods and food products relevant to the search query.'
  );
  const refresh = () => utils.nutrition.invalidate();
  const retry = trpc.nutrition.retryProductIndex.useMutation({ onSuccess: refresh });
  const rebuild = trpc.nutrition.rebuildProductIndex.useMutation({
    retry: false,
    onSettled: refresh,
  });
  const error = retry.error ?? rebuild.error;
  return (
    <Accordion variant="contained">
      <Accordion.Item value="related-food-search">
        <Accordion.Control>Related-food search setup</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            {status.error && (
              <Alert color="red">
                <Text>{status.error.message}</Text>
                <Button variant="subtle" onClick={() => void status.refetch()}>
                  Retry loading search status
                </Button>
              </Alert>
            )}
            {!current && !status.error && <Text role="status">Loading search status…</Text>}
            {current && (
              <>
                <Text size="sm">
                  {current.configuration
                    ? `${current.indexed} of ${current.total} foods ready for related-food search.`
                    : 'A search maintainer needs to choose a model before related-food search can be used.'}
                </Text>
                {current.configuration && (
                  <Text size="xs" c="dimmed">
                    {current.configuration.modelId}
                  </Text>
                )}
                {current.job?.pending && (
                  <Text size="sm" role="status">
                    {current.job.running
                      ? 'Refreshing related-food search…'
                      : 'Refresh queued. Search results will update when it finishes.'}
                  </Text>
                )}
                {current.job?.lastError && <Alert color="yellow">{current.job.lastError}</Alert>}
                <Group>
                  <Button
                    variant="light"
                    disabled={!current.configuration || retry.isPending || current.job?.running}
                    onClick={() => retry.mutate()}
                  >
                    Retry search refresh
                  </Button>
                </Group>
                {current.isMaintainer && (
                  <>
                    <Text fw={600}>Shared food search model</Text>
                    <Text size="sm">
                      Changing this model rebuilds related-food search for every user. Food
                      definitions and diary entries are preserved.
                    </Text>
                    {models.error && (
                      <Alert color="red">
                        <Text>{models.error.message}</Text>
                        <Button variant="subtle" onClick={() => void models.refetch()}>
                          Retry loading models
                        </Button>
                      </Alert>
                    )}
                    <Select
                      label="Embedding model"
                      placeholder={
                        models.isLoading ? 'Loading models…' : 'Choose an installed model'
                      }
                      value={modelId}
                      onChange={setModelId}
                      disabled={rebuild.isPending || current.busy}
                      data={(models.data ?? []).map((model) => ({
                        value: model.id,
                        label: model.id,
                      }))}
                    />
                    <Textarea
                      label="Food search instruction"
                      value={instruction}
                      maxLength={1000}
                      description="Leave empty for models that use raw search text."
                      onChange={(event) => setInstruction(event.currentTarget.value)}
                    />
                    <Group>
                      <Button
                        loading={rebuild.isPending}
                        disabled={!modelId || current.busy}
                        onClick={() =>
                          modals.openConfirmModal({
                            title: 'Rebuild shared food search?',
                            children: (
                              <Text>
                                This rebuilds the search index for every user using {modelId}. The
                                previous index stays available until the replacement is ready.
                              </Text>
                            ),
                            labels: { confirm: 'Rebuild food search', cancel: 'Cancel' },
                            onConfirm: () => {
                              if (modelId) {
                                rebuild.mutate({
                                  selection: { provider: 'ollama', modelId },
                                  queryInstruction: instruction,
                                });
                              }
                            },
                          })
                        }
                      >
                        Rebuild shared food search
                      </Button>
                    </Group>
                    {rebuild.isSuccess && (
                      <Text size="sm" role="status">
                        Food search rebuilt successfully.
                      </Text>
                    )}
                  </>
                )}
              </>
            )}
            {error && <Alert color="red">{error.message}</Alert>}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
