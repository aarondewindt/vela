import 'server-only';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { MAX_IMAGE_BYTES, imageMimeTypes } from './image';
import { attachmentService } from './service';

const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

async function owner(request: Request, mutation = false) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in to access attachments.' });
  }
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') ?? new URL(request.url).host;
  if (
    mutation &&
    (request.headers.get('sec-fetch-site') === 'cross-site' ||
      (origin && origin !== `http://${host}` && origin !== `https://${host}`))
  ) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Attachment changes must come from this site.',
    });
  }
  return session.user.id;
}

function failure(error: unknown) {
  const statuses: Record<string, number> = {
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    BAD_REQUEST: 400,
    PAYLOAD_TOO_LARGE: 413,
    UNSUPPORTED_MEDIA_TYPE: 415,
    CONFLICT: 409,
  };
  const status = error instanceof TRPCError ? (statuses[error.code] ?? 500) : 500;
  return Response.json(
    {
      error:
        status === 500
          ? 'Attachment storage is temporarily unavailable.'
          : (error as Error).message,
    },
    { status, headers: privateHeaders }
  );
}

async function readImage(request: Request) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > MAX_IMAGE_BYTES) {
    throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'Images must not exceed 10 MiB.' });
  }
  const reader = request.body?.getReader();
  if (!reader) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Send image bytes in the request body.' });
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new TRPCError({
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Images must not exceed 10 MiB.',
        });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export async function uploadAttachment(request: Request) {
  try {
    const userId = await owner(request, true);
    const mimeType = request.headers.get('content-type')?.split(';')[0].trim() ?? '';
    if (!(imageMimeTypes as readonly string[]).includes(mimeType)) {
      throw new TRPCError({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Send JPEG, PNG or WebP image bytes.',
      });
    }
    let filename: string;
    try {
      filename = decodeURIComponent(request.headers.get('x-filename') ?? 'image');
    } catch {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid encoded filename.' });
    }
    const metadata = await attachmentService.upload(
      userId,
      await readImage(request),
      filename,
      mimeType
    );
    return Response.json(metadata, { status: 201, headers: privateHeaders });
  } catch (error) {
    return failure(error);
  }
}

export async function accessAttachment(request: Request, rawId: string, remove = false) {
  try {
    const userId = await owner(request, remove);
    const id = z.uuid().safeParse(rawId);
    if (!id.success) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid attachment ID.' });
    }
    if (remove) {
      await attachmentService.remove(userId, id.data);
      return new Response(null, { status: 204, headers: privateHeaders });
    }
    const { metadata, bytes } = await attachmentService.retrieve(userId, id.data);
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...privateHeaders,
        'Content-Type': metadata.mimeType,
        'Content-Length': String(bytes.length),
        'Content-Disposition': `inline; filename="image.${metadata.mimeType.split('/')[1]}"`,
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
