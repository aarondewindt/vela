/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('./service', () => ({
  attachmentService: { upload: jest.fn(), retrieve: jest.fn(), remove: jest.fn() },
}));

import { TRPCError } from '@trpc/server';
import { auth } from '@/lib/auth';
import { attachmentService } from './service';
import { MAX_IMAGE_BYTES } from './image';
import { POST } from '@/app/api/attachments/route';
import { GET, DELETE } from '@/app/api/attachments/[id]/route';

const id = 'a98f7dce-f7a5-420f-89ae-a7786aa20341';
const context = { params: Promise.resolve({ id }) };
const request = (options: RequestInit = {}) =>
  new Request('http://localhost/api/attachments', options);
const upload = (headers: Record<string, string> = {}, body: BodyInit = 'bytes') =>
  request({
    method: 'POST',
    headers: { 'content-type': 'image/png', ...headers },
    body,
  });
beforeEach(() => {
  jest.resetAllMocks();
  (auth.api.getSession as unknown as jest.Mock).mockResolvedValue({ user: { id: 'alice' } });
});

it('requires a Better Auth session for upload, retrieval and deletion', async () => {
  (auth.api.getSession as unknown as jest.Mock).mockResolvedValue(null);
  for (const response of [
    await POST(upload()),
    await GET(request(), context),
    await DELETE(request(), context),
  ]) {
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  }
  expect(attachmentService.upload).not.toHaveBeenCalled();
  expect(attachmentService.retrieve).not.toHaveBeenCalled();
});

it('returns stable metadata, accepts independent uploads, and uses the session owner', async () => {
  (attachmentService.upload as jest.Mock).mockResolvedValue({ id, mimeType: 'image/png' });
  for (const name of ['front.png', 'back.png']) {
    const response = await POST(upload({ 'x-filename': encodeURIComponent(name) }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id, mimeType: 'image/png' });
    expect(attachmentService.upload).toHaveBeenLastCalledWith(
      'alice',
      Buffer.from('bytes'),
      name,
      'image/png'
    );
  }
});

it('serves binary images privately with safe response headers', async () => {
  (attachmentService.retrieve as jest.Mock).mockResolvedValue({
    metadata: { mimeType: 'image/png' },
    bytes: Buffer.from('original'),
  });
  const response = await GET(request(), context);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('original');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(attachmentService.retrieve).toHaveBeenCalledWith('alice', id);
  expect((await DELETE(request({ method: 'DELETE' }), context)).status).toBe(204);
  expect(attachmentService.remove).toHaveBeenCalledWith('alice', id);
});

it('rejects cross-site mutations, invalid MIME types, filenames and IDs', async () => {
  expect((await POST(upload({ origin: 'https://evil.example' }))).status).toBe(403);
  expect(
    (await DELETE(request({ headers: { 'sec-fetch-site': 'cross-site' } }), context)).status
  ).toBe(403);
  expect((await POST(upload({ 'content-type': 'image/svg+xml' }))).status).toBe(415);
  expect((await POST(upload({ 'x-filename': '%' }))).status).toBe(400);
  expect((await GET(request(), { params: Promise.resolve({ id: '../secret' }) })).status).toBe(400);
  expect(attachmentService.upload).not.toHaveBeenCalled();
});

it('bounds bodies with and without Content-Length', async () => {
  expect((await POST(upload({ 'content-length': String(MAX_IMAGE_BYTES + 1) }))).status).toBe(413);
  expect((await POST(upload({}, Buffer.alloc(MAX_IMAGE_BYTES + 1)))).status).toBe(413);
  expect(attachmentService.upload).not.toHaveBeenCalled();
});

it.each(['NOT_FOUND', 'CONFLICT', 'BAD_REQUEST'] as const)(
  'maps %s errors without revealing storage internals',
  async (code) => {
    (attachmentService.retrieve as jest.Mock).mockRejectedValue(
      new TRPCError({ code, message: 'Public error.' })
    );
    expect((await GET(request(), context)).status).toBe(
      { NOT_FOUND: 404, CONFLICT: 409, BAD_REQUEST: 400 }[code]
    );
  }
);

it('redacts unexpected storage/database errors', async () => {
  (attachmentService.upload as jest.Mock).mockRejectedValue(
    new Error('/private/path database password')
  );
  const response = await POST(upload());
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('/private/path');
});
