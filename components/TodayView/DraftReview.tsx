'use client';
import { Alert, Button, Modal, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';

export function DraftReview({ date }: { date: string }) {
  const [opened, setOpened] = useState(false);
  const review = trpc.plannerDraft.review.useMutation();
  return (
    <>
      <Button
        size="xs"
        variant="default"
        onClick={() => {
          setOpened(true);
          review.mutate({ date, mode: 'deterministic' });
        }}
      >
        Review schedule
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title="Schedule review">
        <Stack>
          {review.isPending && <Text size="sm">Reviewing schedule…</Text>}
          {review.error && <Alert color="red">{review.error.message}</Alert>}
          {review.data && (
            <>
              <Text size="sm">
                {review.data.conflicts.length} verified conflicts · {review.data.concerns.length}{' '}
                advisory concerns
              </Text>
              {[...review.data.conflicts, ...review.data.concerns].map((item, index) => (
                <Alert key={index} color="yellow">
                  {item.explanation}
                </Alert>
              ))}
              {review.data.warnings.map((message, index) => (
                <Text key={index} size="sm" c="dimmed">
                  {message}
                </Text>
              ))}
            </>
          )}
        </Stack>
      </Modal>
    </>
  );
}
