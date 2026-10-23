import { TRPCError } from '@trpc/server';
import { z } from 'zod';

export function requireDeviceHttps() {
  // TLS terminates at the configured gateway; never trust arbitrary forwarded headers.
  if (!process.env.BETTER_AUTH_URL?.startsWith('https://')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Device access requires an HTTPS deployment.',
    });
  }
}
export async function deviceResponse(operation: () => Promise<unknown>) {
  const headers = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
  try {
    requireDeviceHttps();
    return Response.json(await operation(), { headers });
  } catch (error) {
    const code =
      error instanceof TRPCError
        ? error.code
        : error instanceof z.ZodError
          ? 'BAD_REQUEST'
          : 'INTERNAL_SERVER_ERROR';
    const status =
      {
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        BAD_REQUEST: 400,
        TOO_MANY_REQUESTS: 429,
        PAYLOAD_TOO_LARGE: 413,
      }[code as string] ?? 500;
    return Response.json(
      { error: status === 500 ? 'Device request failed.' : code },
      { status, headers: { ...headers, ...(status === 429 ? { 'Retry-After': '60' } : {}) } }
    );
  }
}
export async function boundedJson(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    throw new TRPCError({ code: 'BAD_REQUEST' });
  }
  const reader = request.body?.getReader();
  if (!reader) {
    throw new TRPCError({ code: 'BAD_REQUEST' });
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.length;
      if (size > 2048) {
        await reader.cancel();
        throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE' });
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new TRPCError({ code: 'BAD_REQUEST' });
    }
  } finally {
    reader.releaseLock();
  }
}
