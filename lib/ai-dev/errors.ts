import 'server-only';

import { AiError } from '@/lib/ai';

export function getAiDevError(error: unknown): { status: number; message: string } {
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
