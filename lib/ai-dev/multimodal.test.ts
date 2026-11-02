/** @jest-environment node */
jest.mock('ai', () => ({
  convertToModelMessages: jest.fn(async (messages, options) =>
    messages.map((message: any) => ({
      role: message.role,
      content: message.parts.map((part: any) =>
        part.type.startsWith('data-') ? options.convertDataPart(part) : part
      ),
    }))
  ),
}));
jest.mock('server-only', () => ({}));
jest.mock('@/lib/attachments/model-image', () => ({
  prepareModelImage: jest.fn(async (bytes: Buffer, mediaType: string) => ({ bytes, mediaType })),
}));
jest.mock('@/lib/attachments/service', () => ({ attachmentService: { retrieve: jest.fn() } }));
import { reconstructModelMessages } from './multimodal';
import { attachmentService } from '@/lib/attachments/service';
import type { UIMessage } from 'ai';
const id = '45f6af99-9a30-4638-b05f-fb826b970379';
const image = { type: 'data-attachment' as const, data: { attachmentId: id } };
const bytes = Buffer.from('synthetic image bytes');
const history: UIMessage[] = [
  {
    id: 'u',
    role: 'user',
    parts: [{ type: 'text', text: 'Front' }, image, { type: 'text', text: 'Back' }, image],
  },
  { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'Review' }] },
  { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Read the earlier photo again' }] },
];
beforeEach(() => jest.clearAllMocks());
it('reconstructs ordered binary files, caches reused IDs, and retains earlier photos on follow-up', async () => {
  jest.mocked(attachmentService.retrieve).mockResolvedValue({
    bytes,
    metadata: { mimeType: 'image/png', storageKey: '/private/never-forward' },
  } as any);
  const result = await reconstructModelMessages('alice', history);
  expect(attachmentService.retrieve).toHaveBeenCalledTimes(1);
  expect(attachmentService.retrieve).toHaveBeenCalledWith('alice', id);
  expect(result[0]).toEqual({
    role: 'user',
    content: [
      { type: 'text', text: 'Front' },
      { type: 'file', data: bytes, mediaType: 'image/png' },
      { type: 'text', text: 'Back' },
      { type: 'file', data: bytes, mediaType: 'image/png' },
    ],
  });
  expect(result[2]).toMatchObject({
    role: 'user',
    content: [{ type: 'text', text: 'Read the earlier photo again' }],
  });
  expect(JSON.stringify(result)).not.toContain('/private/');
  expect(history[0].parts[1]).toEqual(image);
});
it('fails closed on foreign, deleted or missing image retrieval', async () => {
  jest.mocked(attachmentService.retrieve).mockRejectedValue(new Error('Attachment not found.'));
  await expect(reconstructModelMessages('bob', history)).rejects.toThrow('Attachment not found.');
});

it('reconstructs distinct front/back images and previous structured suggestions on correction', async () => {
  jest
    .mocked(attachmentService.retrieve)
    .mockResolvedValue({ bytes, metadata: { mimeType: 'image/png' } } as any);
  const backId = '45f6af99-9a30-4638-b05f-fb826b970378';
  const previous = {
    type: 'data-productSuggestion' as const,
    data: {
      product: { brand: 'Jumbo' },
      evidence: { tables: ['obsolete misread table'] },
      warnings: ['obsolete warning'],
    },
  };
  const result = await reconstructModelMessages('alice', [
    {
      id: 'front-back',
      role: 'user',
      parts: [image, { type: 'data-attachment', data: { attachmentId: backId } }],
    },
    { id: 'previous', role: 'assistant', parts: [previous] },
    history[2],
  ]);
  expect(attachmentService.retrieve).toHaveBeenCalledTimes(2);
  expect(attachmentService.retrieve).toHaveBeenCalledWith('alice', backId);
  expect(result[0].content).toHaveLength(2);
  expect(result[1].content).toEqual([
    {
      type: 'text',
      text: `Previous unverified AI-proposed fields, not source evidence. Re-read the photographs: ${JSON.stringify(previous.data.product)}`,
    },
  ]);
  expect(JSON.stringify(result)).not.toContain('obsolete');
});

it('sends model-prepared bytes and MIME type after owner-authorized retrieval', async () => {
  const { prepareModelImage } = await import('@/lib/attachments/model-image');
  const prepared = Buffer.from('upright model bytes');
  jest
    .mocked(attachmentService.retrieve)
    .mockResolvedValue({ bytes, metadata: { mimeType: 'image/jpeg' } } as any);
  jest.mocked(prepareModelImage).mockResolvedValueOnce({ bytes: prepared, mediaType: 'image/png' });
  const result = await reconstructModelMessages('alice', history);
  expect(prepareModelImage).toHaveBeenCalledTimes(1);
  expect(prepareModelImage).toHaveBeenCalledWith(bytes, 'image/jpeg');
  expect(result[0].content[1]).toEqual({ type: 'file', data: prepared, mediaType: 'image/png' });
  expect(result[0].content[3]).toEqual(result[0].content[1]);
});
