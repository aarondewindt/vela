'use client';

import { useState } from 'react';
import { Anchor, Image, Text } from '@mantine/core';

/** Uses the authenticated binary endpoint, including when restoring saved history. */
export function AttachmentImage({ attachmentId }: { attachmentId: string }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/attachments/${encodeURIComponent(attachmentId)}`;
  return failed ? (
    <Text size="sm" c="dimmed" role="status">
      Image unavailable. It may be missing or you may need to sign in again.
    </Text>
  ) : (
    <Anchor href={src} target="_blank" rel="noreferrer" aria-label="Open attached image">
      <Image
        src={src}
        alt="Attached image"
        w={160}
        h={160}
        maw="100%"
        fit="contain"
        radius="sm"
        onError={() => setFailed(true)}
      />
    </Anchor>
  );
}
