import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { TRPCError } from '@trpc/server';

export function homeAssistantUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Enter a valid Home Assistant origin.' });
  }
  const allowed = (process.env.HOME_ASSISTANT_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !allowed.includes(url.origin)
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'This Home Assistant origin is not allowed. Configure HOME_ASSISTANT_ALLOWED_ORIGINS on the server.',
    });
  }
  return url.origin;
}
function encryptionKey() {
  const value = process.env.INTEGRATION_ENCRYPTION_KEY ?? '';
  if (!/^[a-f\d]{64}$/i.test(value)) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Configure a 64-character hex INTEGRATION_ENCRYPTION_KEY on the server.',
    });
  }
  return Buffer.from(value, 'hex');
}
export function encryptToken(token: string, userId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((x) => x.toString('base64')).join('.');
}
export function decryptToken(value: string, userId: string) {
  const [iv, tag, encrypted] = value.split('.').map((x) => Buffer.from(x, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(userId));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8');
}
