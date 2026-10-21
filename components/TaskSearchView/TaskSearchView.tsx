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
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import classes from './TaskSearchView.module.css';

export function TaskSearchView() {
  const utils = trpc.useUtils();
  const status = trpc.taskSearch.status.useQuery(undefined, {
    retry: false,
    refetchOnMount: 'always',
    refetchInterval: (query) =>
      query.state.data?.busy || query.state.data?.job?.pending ? 2000 : false,
  });
  const current = status.isFetchedAfterMount && !status.error ? status.data : undefined;
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState<number>(10);
  const [notice, setNotice] = useState<string | null>(null);
  const search = trpc.taskSearch.search.useMutation({ retry: false, gcTime: 0 });
  const refresh = () => utils.taskSearch.status.invalidate();
  const index = trpc.taskSearch.retry.useMutation({
    retry: false,
    onSuccess: async () => {
      setNotice('Task index refresh queued. The background worker will process it.');
      search.reset();
      await refresh();
    },
    onSettled: refresh,
  });
  const busy = index.isPending || Boolean(current?.busy);
  const failure = index.error;

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <div>
          <Title order={2}>Fuzzy task search</Title>
          <Text c="dimmed" mt={4}>
            Search your tasks by meaning. Task changes queue automatic background indexing.
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
                  New or edited tasks queue a background refresh. Stale vectors are excluded from
                  searches. Your existing tasks are not modified.
                </Text>
                {current.job?.pending && (
                  <Text size="sm" c="dimmed">
                    {current.job.running
                      ? 'Refreshing task index…'
                      : 'Task index refresh queued; waiting for the worker.'}
                  </Text>
                )}
                {current.job?.lastError && <Alert color="red">{current.job.lastError}</Alert>}
                <Group>
                  <Button
                    disabled={!current.configuration || busy}
                    loading={index.isPending}
                    onClick={() => {
                      setNotice(null);
                      index.reset();
                      index.mutate();
                    }}
                  >
                    Queue index refresh
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
            <Button component={Link} href="/settings#ai-models" variant="subtle">
              Manage search models in Settings
            </Button>
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
