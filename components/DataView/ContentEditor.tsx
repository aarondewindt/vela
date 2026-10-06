'use client';

import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

import { useEffect, useRef } from 'react';
import { Center, Loader, useComputedColorScheme } from '@mantine/core';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';

export type Blocks = Record<string, unknown>[];

type Props = {
  id: string;
  isPending: boolean;
  content: Blocks | null | undefined;
  onSave: (blocks: Blocks) => void;
};

const SAVE_DELAY_MS = 800;

function Editor({ initialContent, onSave }: { initialContent: Blocks | null; onSave: Props['onSave'] }) {
  const colorScheme = useComputedColorScheme('dark');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<Blocks | null>(null);

  // BlockNote rejects an empty initial document.
  const editor = useCreateBlockNote({
    initialContent: initialContent?.length ? (initialContent as never) : undefined,
  });

  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current) {
      onSave(pending.current);
      pending.current = null;
    }
  };

  // Save any pending edit when switching items or closing the inspector.
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

export function ContentEditor({ id, isPending, content, onSave }: Props) {
  if (isPending) {
    return (
      <Center py="md">
        <Loader size="sm" />
      </Center>
    );
  }

  return <Editor key={id} initialContent={content ?? null} onSave={onSave} />;
}
