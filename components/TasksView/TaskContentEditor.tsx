'use client';

import { useTaskContentQuery, useUpdateTaskContentMutation } from '@/lib/planner/query';
import { ContentEditor, type Blocks } from '../DataView/ContentEditor';

export function TaskContentEditor({ taskId }: { taskId: string }) {
  const content = useTaskContentQuery(taskId);
  const { mutate } = useUpdateTaskContentMutation();

  return (
    <ContentEditor
      id={taskId}
      isPending={content.isPending}
      content={content.data as Blocks | null | undefined}
      onSave={(blocks) => mutate({ id: taskId, content: blocks })}
    />
  );
}
