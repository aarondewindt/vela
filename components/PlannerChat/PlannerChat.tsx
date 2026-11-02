'use client';
import { Text } from '@mantine/core';
import { ConversationChat } from '../AiDevView/AiDevView';

export function PlannerChat({ date }: { date: string }) {
  return (
    <ConversationChat plannerDate={date}>
      <Text size="xs" c="dimmed">
        Ask to plan or adjust this day. Changes appear in your working draft; accept them in the
        calendar.
      </Text>
    </ConversationChat>
  );
}
