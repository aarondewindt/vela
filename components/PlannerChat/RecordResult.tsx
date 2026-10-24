'use client';
import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import { RecordReview } from '../PlannerConversation/RecordReview';

export function RecordResult({
  conversationId,
  id,
  onRevise,
}: {
  conversationId: string;
  id: string;
  onRevise?: () => void;
}) {
  const utils = trpc.useUtils();
  const reference = { conversationId, id };
  const query = trpc.plannerChat.getRecordPreview.useQuery(reference, { refetchInterval: 5000 });
  const resolve = trpc.plannerChat.resolveRecordPreview.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.plannerChat.getRecordPreview.invalidate(),
        utils.plannerChat.pendingRecordPreview.invalidate(),
        utils.planner.invalidate(),
        utils.planningProposals.invalidate(),
        utils.taskSearch.invalidate(),
        utils.taskReviews.invalidate(),
      ]);
    },
  });
  const error = query.error ?? resolve.error;
  const row = query.data;
  return (
    <Stack gap="xs">
      {error && (
        <Alert color="red" role="alert">
          {error.message}
        </Alert>
      )}
      {query.isLoading && <Text role="status">Loading record preview…</Text>}
      {row && (
        <>
          <RecordReview
            key={id}
            preview={row.preview}
            accepted={row.accepted}
            active={row.status === 'PENDING' && !row.stale}
            busy={resolve.isPending}
            accept={(confirmDeletion) =>
              resolve.mutate({ ...reference, action: 'accept', confirmDeletion })
            }
          />
          {row.stale && (
            <Alert color="yellow">
              The records changed. Describe the correction again to refresh this preview before
              accepting.
            </Alert>
          )}
          <Text size="xs" c="dimmed">
            {row.status}
          </Text>
          <Group>
            {row.status === 'PENDING' && (
              <>
                <Button
                  size="xs"
                  variant="default"
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ ...reference, action: 'discard' })}
                >
                  Discard record preview
                </Button>
                {onRevise && (
                  <Button size="xs" variant="subtle" onClick={onRevise}>
                    Revise in chat
                  </Button>
                )}
              </>
            )}
            <Button component={Link} href="/planner/tasks" size="xs" variant="subtle">
              Open Tasks
            </Button>
          </Group>
        </>
      )}
    </Stack>
  );
}
