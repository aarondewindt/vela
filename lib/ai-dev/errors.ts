import 'server-only';

import { AiError } from '@/lib/ai';
import { TRPCError } from '@trpc/server';

export function getAiDevError(error: unknown): { status: number; message: string } {
  if (error instanceof TRPCError && ['NOT_FOUND', 'CONFLICT', 'BAD_REQUEST'].includes(error.code)) {
    return {
      status: error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : 400,
      message: error.message,
    };
  }
  if (error instanceof AiError) {
    switch (error.code) {
      case 'MODEL_NOT_FOUND':
      case 'MODEL_NOT_SUPPORTED':
      case 'PROVIDER_NOT_SUPPORTED':
        return { status: 400, message: error.message };
      case 'CONFIGURATION_ERROR':
      case 'PROVIDER_UNAVAILABLE':
        return { status: 503, message: error.message };
      case 'INVALID_PROVIDER_RESPONSE':
        return { status: 502, message: error.message };
    }
  }
  return { status: 500, message: 'AI Dev is temporarily unavailable. Please try again.' };
}
