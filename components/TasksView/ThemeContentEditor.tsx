'use client';

import { useThemeContentQuery, useUpdateThemeContentMutation } from '@/lib/planner/query';
import { ContentEditor, type Blocks } from '../DataView/ContentEditor';

export function ThemeContentEditor({ themeId }: { themeId: string }) {
  const content = useThemeContentQuery(themeId);
  const { mutate } = useUpdateThemeContentMutation();

  return (
    <ContentEditor
      id={themeId}
      isPending={content.isPending}
      content={content.data as Blocks | null | undefined}
      onSave={(blocks) => mutate({ id: themeId, content: blocks })}
    />
  );
}
