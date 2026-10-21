'use client';

import { Accordion, Alert, Button, Group, Stack, Text } from '@mantine/core';
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
  const refresh = () => utils.nutrition.invalidate();
  const retry = trpc.nutrition.retryProductIndex.useMutation({ onSuccess: refresh });
  const error = retry.error;
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
              </>
            )}
            {error && <Alert color="red">{error.message}</Alert>}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
