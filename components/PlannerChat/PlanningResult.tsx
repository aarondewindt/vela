'use client';
import { Button, Stack, Text, Spoiler } from '@mantine/core';
import { RecordResult } from './RecordResult';
import { planningResultSchema } from '@/lib/planner/chat/result';

// Schedule changes are visible in the draft DayView. Inventory record previews
// remain separate, with their established explicit approval requirements.
export function PlanningResult({
  value,
  onRevise,
  conversationId,
  onChoose,
}: {
  value: unknown;
  onRevise?: () => void;
  conversationId?: string;
  onChoose?: (id: string) => void;
}) {
  const parsed = planningResultSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const result = parsed.data;
  return (
    <Stack gap="xs">
      {result.matches?.map((match) => (
        <Button key={match.id} size="xs" variant="subtle" onClick={() => onChoose?.(match.id)}>
          {match.label}
        </Button>
      ))}
      {result.recordProposalId && conversationId && (
        <RecordResult
          conversationId={conversationId}
          id={result.recordProposalId}
          onRevise={onRevise}
        />
      )}
      {result.review && (
        <Spoiler maxHeight={0} showLabel="Review details" hideLabel="Hide review details">
          <Text size="sm">
            {[...result.review.conflicts, ...result.review.concerns]
              .map((c) => c.explanation)
              .join('\n') || 'No conflicts found.'}
          </Text>
        </Spoiler>
      )}
    </Stack>
  );
}
