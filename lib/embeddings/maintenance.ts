import 'server-only';
import { TRPCError } from '@trpc/server';

export function isEmbeddingMaintainer(userId: string) {
  return (process.env.EMBEDDING_MAINTAINER_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);
}

export function requireEmbeddingMaintainer(userId: string) {
  if (!isEmbeddingMaintainer(userId)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only an embedding maintainer can change models or rebuild the shared collection.',
    });
  }
}
