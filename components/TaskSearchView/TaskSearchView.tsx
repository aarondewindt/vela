'use client';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { trpc } from '@/lib/trpc/client';
import classes from './TaskSearchView.module.css';

export function TaskSearchView() {
  const utils = trpc.useUtils();
  const status = trpc.taskSearch.status.useQuery(undefined, {
    retry: false,
    refetchOnMount: 'always',
    refetchInterval: (query) => (query.state.data?.busy ? 2000 : false),
  });
  const current = status.isFetchedAfterMount && !status.error ? status.data : undefined;
  const models = trpc.taskSearch.models.useQuery(undefined, {
    enabled: Boolean(current?.isMaintainer),
    retry: false,
  });
  const [modelId, setModelId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('Find tasks relevant to the search query.');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState<number>(10);
  const [notice, setNotice] = useState<string | null>(null);
  const search = trpc.taskSearch.search.useMutation({ retry: false, gcTime: 0 });
  const refresh = () => utils.taskSearch.status.invalidate();
  const index = trpc.taskSearch.index.useMutation({
    retry: false,
    onSuccess: async (result) => {
      setNotice(`Indexed ${result.indexed} tasks; generated ${result.generated} embeddings.`);
      search.reset();
      await refresh();
    },
    onSettled: refresh,
  });
  const rebuild = trpc.taskSearch.rebuild.useMutation({
    retry: false,
    onSuccess: async (result) => {
      setNotice(
        `Rebuilt the shared collection: ${result.indexed} tasks, ${result.configuration.dimensions} dimensions.`
      );
      search.reset();
      await refresh();
    },
    onSettled: refresh,
  });
  const busy = index.isPending || rebuild.isPending || Boolean(current?.busy);
  const failure = index.error ?? rebuild.error;

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <div>
          <Title order={2}>Fuzzy task search</Title>
          <Text c="dimmed" mt={4}>
            Search your tasks by meaning. This is an experimental test page with manual indexing.
          </Text>
        </div>
        {!current && !status.error && (
          <Group role="status">
            <Loader size="sm" />
            <Text>Loading task index…</Text>
          </Group>
        )}
        {status.error && (
          <Alert color="red" title="Could not load task index">
            <Text>{status.error.message}</Text>
            <Button variant="light" onClick={() => void status.refetch()}>
              Retry loading index
            </Button>
          </Alert>
        )}
        {current && (
          <>
            <Paper withBorder p="md" radius="md">
              <Stack gap="sm">
                <Group justify="space-between">
                  <Title order={3}>Your task index</Title>
                  <Badge color={current.configuration ? 'blue' : 'gray'}>
                    {current.configuration ? 'Configured' : 'Not configured'}
                  </Badge>
                </Group>
                {current.configuration ? (
                  <>
                    <Text size="sm">
                      {current.configuration.modelId} ·{' '}
                      {current.configuration.dimensions.toLocaleString('en-US')} dimensions
                    </Text>
                    <Text>
                      {current.indexed} of {current.total} tasks current · {current.pending} need
                      indexing
                    </Text>
                  </>
                ) : (
                  <Text>
                    A maintainer needs to choose a model and build the shared collection first.
                  </Text>
                )}
                <Text size="sm" c="dimmed">
                  New or edited tasks need manual indexing. Stale vectors are excluded from
                  searches. Your existing tasks are not modified.
                </Text>
                <Group>
                  <Button
                    disabled={!current.configuration || busy}
                    loading={index.isPending}
                    onClick={() => {
                      setNotice(null);
                      index.reset();
                      rebuild.reset();
                      index.mutate();
                    }}
                  >
                    Index my tasks
                  </Button>
                  <Button
                    variant="default"
                    loading={status.isFetching}
                    onClick={() => void status.refetch()}
                  >
                    Refresh index status
                  </Button>
                </Group>
                {busy && (
                  <Text role="status">
                    Indexing is in progress. The previous published index remains available.
                  </Text>
                )}
                {current.lastError && !failure && <Alert color="yellow">{current.lastError}</Alert>}
              </Stack>
            </Paper>
            {current.isMaintainer && (
              <Paper withBorder p="md" radius="md">
                <Stack>
                  <Title order={3}>Shared collection settings</Title>
                  <Text size="sm" c="dimmed">
                    Maintainer controls. Rebuilding replaces embeddings for all users’ tasks with
                    one model and configuration.
                  </Text>
                  {models.isPending && <Text role="status">Loading embedding models…</Text>}
                  {models.error && <Alert color="red">{models.error.message}</Alert>}
                  {models.isSuccess && models.data.length === 0 && (
                    <Alert color="yellow">No embedding models are installed in Ollama.</Alert>
                  )}
                  <Group align="flex-end">
                    <Select
                      className={classes.modelPicker}
                      label="Embedding model"
                      placeholder="Choose a model for the rebuild"
                      searchable
                      allowDeselect={false}
                      value={modelId}
                      onChange={setModelId}
                      data={
                        models.data?.map((model) => ({ value: model.id, label: model.id })) ?? []
                      }
                      disabled={busy || models.isPending || Boolean(models.error)}
                    />
                    <Button
                      variant="default"
                      loading={models.isFetching}
                      disabled={busy}
                      onClick={() => void models.refetch()}
                    >
                      Refresh models
                    </Button>
                  </Group>
                  <Textarea
                    label="Query instruction"
                    description="Prepended to search queries. Leave empty to send raw queries. Changing it requires a full rebuild."
                    value={instruction}
                    onChange={(event) => setInstruction(event.currentTarget.value)}
                    maxLength={1000}
                    disabled={busy}
                    minRows={2}
                  />
                  <Group>
                    <Button
                      color="orange"
                      disabled={!modelId || busy || Boolean(models.error)}
                      loading={rebuild.isPending}
                      onClick={() => {
                        if (!modelId) {
                          return;
                        }
                        modals.openConfirmModal({
                          title: 'Rebuild shared task collection?',
                          children: (
                            <Text>
                              This rebuilds embeddings for every user’s tasks using {modelId}. The
                              previous index stays active until the replacement is complete.
                            </Text>
                          ),
                          labels: { confirm: 'Rebuild collection', cancel: 'Cancel' },
                          confirmProps: { color: 'orange' },
                          onConfirm: () => {
                            setNotice(null);
                            index.reset();
                            rebuild.reset();
                            rebuild.mutate({
                              selection: { provider: 'ollama', modelId },
                              queryInstruction: instruction.trim(),
                            });
                          },
                        });
                      }}
                    >
                      Rebuild shared task index
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            )}
          </>
        )}
        {notice && (
          <Alert color="green" role="status">
            {notice}
          </Alert>
        )}
        {failure && (
          <Alert color="red" title="Indexing failed">
            {failure.message}
          </Alert>
        )}
        <Paper withBorder p="md" radius="md">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (query.trim() && current?.configuration && !search.isPending) {
                search.mutate({ query: query.trim(), limit });
              }
            }}
          >
            <Stack>
              <Title order={3}>Search tasks</Title>
              <Textarea
                label="Search query"
                placeholder="For example: things I need to arrange before going on holiday"
                minRows={2}
                maxLength={2000}
                value={query}
                disabled={search.isPending}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  search.reset();
                }}
              />
              <Group align="flex-end">
                <NumberInput
                  label="Maximum results"
                  min={1}
                  max={50}
                  allowDecimal={false}
                  value={limit}
                  disabled={search.isPending}
                  onChange={(value) => {
                    setLimit(typeof value === 'number' ? value : 10);
                    search.reset();
                  }}
                />
                <Button
                  type="submit"
                  disabled={!current?.configuration || !query.trim()}
                  loading={search.isPending}
                >
                  Search
                </Button>
              </Group>
              {search.isPending && <Text role="status">Searching your tasks…</Text>}
              {search.error && (
                <Alert color="red" title="Search failed">
                  {search.error.message}
                </Alert>
              )}
              {current && search.data && !search.error && !search.isPending && (
                <Stack aria-label="Search results" role="region">
                  <Text size="sm" c="dimmed">
                    {search.data.configuration.modelId} · Ranked by cosine similarity; scores are
                    not probabilities.
                  </Text>
                  {search.data.results.length === 0 && (
                    <Text>
                      No indexed tasks matched. Index your tasks if any are missing or have changed.
                    </Text>
                  )}
                  {search.data.results.map((task) => (
                    <Paper key={task.id} withBorder p="sm" radius="sm" component="article">
                      <Group justify="space-between">
                        <Text fw={600}>{task.title}</Text>
                        <Badge variant="light">Cosine {task.similarity.toFixed(4)}</Badge>
                      </Group>
                      <Text size="xs" c="dimmed">
                        {task.status.replaceAll('_', ' ')}
                      </Text>
                      {task.brief && (
                        <Text size="sm" mt="xs" className={classes.description}>
                          {task.brief}
                        </Text>
                      )}
                    </Paper>
                  ))}
                </Stack>
              )}
            </Stack>
          </form>
        </Paper>
      </Stack>
    </Container>
  );
}
