'use client';

import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

import { useEffect, useRef } from 'react';
import { Center, Loader, useComputedColorScheme } from '@mantine/core';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import { useTaskContentQuery, useUpdateTaskContentMutation } from '@/lib/planner/query';

type Blocks = Record<string, unknown>[];

const SAVE_DELAY_MS = 800;

function Editor({ taskId, initialContent }: { taskId: string; initialContent: Blocks | null }) {
  const colorScheme = useComputedColorScheme('dark');
  const { mutate } = useUpdateTaskContentMutation();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<Blocks | null>(null);

  // BlockNote rejects an empty initial document.
  const editor = useCreateBlockNote({
    initialContent: initialContent?.length ? (initialContent as never) : undefined,
  });

  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current) {
      mutate({ id: taskId, content: pending.current });
      pending.current = null;
    }
  };

  // Save any pending edit when switching tasks or closing the inspector.
  useEffect(() => flush, []);

  return (
    <BlockNoteView
      editor={editor}
      theme={colorScheme}
      onChange={() => {
        pending.current = editor.document as unknown as Blocks;
        clearTimeout(timer.current);
        timer.current = setTimeout(flush, SAVE_DELAY_MS);
      }}
    />
  );
}

export function TaskContentEditor({ taskId }: { taskId: string }) {
  const content = useTaskContentQuery(taskId);

  if (content.isPending) {
    return (
      <Center py="md">
        <Loader size="sm" />
      </Center>
    );
  }

  return <Editor key={taskId} taskId={taskId} initialContent={(content.data as Blocks | null) ?? null} />;
}
