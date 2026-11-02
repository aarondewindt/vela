import 'server-only';
import { convertToModelMessages, type UIMessage, type FilePart } from 'ai';
import { prepareModelImage } from '@/lib/attachments/model-image';
import { attachmentService } from '@/lib/attachments/service';
import type { ProductSuggestion } from '@/lib/nutrition/product-extraction/schema';
import { attachmentId } from './schema';

/** Resolve only persistent IDs; never fetch client URLs. Bytes remain server-side. */
export async function reconstructModelMessages(
  userId: string,
  history: UIMessage[],
  attachments: Pick<typeof attachmentService, 'retrieve'> = attachmentService
) {
  const ids = [
    ...new Set(
      history.flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === 'data-attachment' ? [attachmentId(part)] : []
        )
      )
    ),
  ];
  if (!ids.length) {
    return convertToModelMessages(history);
  }
  const files = new Map<string, FilePart>();
  // Bound memory and I/O concurrency; reused references read the same file once per turn.
  for (const id of ids) {
    const { bytes, metadata } = await attachments.retrieve(userId, id);
    const prepared = await prepareModelImage(bytes, metadata.mimeType);
    files.set(id, { type: 'file', data: prepared.bytes, mediaType: prepared.mediaType });
  }
  return convertToModelMessages(history, {
    convertDataPart: (part) =>
      part.type === 'data-attachment'
        ? files.get(attachmentId(part))
        : part.type === 'data-productSuggestion'
          ? {
              type: 'text',
              // Prior OCR tables can anchor a correction to the very misread digits
              // it should replace. Keep proposed fields as context, not old evidence.
              text: `Previous unverified AI-proposed fields, not source evidence. Re-read the photographs: ${JSON.stringify((part.data as ProductSuggestion).product)}`,
            }
          : undefined,
  });
}
