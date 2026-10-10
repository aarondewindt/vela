'use client';

import '@blocknote/core/fonts/inter.css';

import { useEffect, useRef } from 'react';
import { Center, Loader, useComputedColorScheme } from '@mantine/core';
import { BlockNoteView, darkDefaultTheme } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import { darkPalette } from '@/theme';
import styles from './ContentEditor.module.css';

export type Blocks = Record<string, unknown>[];

type Props = {
  id: string;
  isPending: boolean;
  content: Blocks | null | undefined;
  onSave: (blocks: Blocks) => void;
};

const SAVE_DELAY_MS = 800;

const blockNoteDarkTheme = {
  ...darkDefaultTheme,
  colors: {
    ...darkDefaultTheme.colors,
    editor: {
      text: darkPalette[0],
      background: darkPalette[7],
    },
    menu: {
      text: darkPalette[0],
      background: darkPalette[7],
    },
    tooltip: {
      text: darkPalette[0],
      background: darkPalette[8],
    },
    hovered: {
      text: darkPalette[0],
      background: darkPalette[5],
    },
    selected: {
      text: darkPalette[0],
      background: darkPalette[5],
    },
    disabled: {
      text: darkPalette[3],
      background: darkPalette[6],
    },
    shadow: darkPalette[9],
    border: darkPalette[4],
    sideMenu: darkPalette[5],
  },
};

function Editor({
  initialContent,
  onSave,
}: {
  initialContent: Blocks | null;
  onSave: Props['onSave'];
}) {
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
      // className={styles.editor}
      editor={editor}
      theme={colorScheme === 'dark' ? blockNoteDarkTheme : 'light'}
      // data-mantine-color-scheme={colorScheme}
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
