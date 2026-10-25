import 'server-only';
import type { LanguageModelMiddleware } from 'ai';

/**
 * ollama-ai-provider-v2 4.0.1 unwraps v4 file data before passing it to the
 * provider-utils converter, which expects tagged data. Base64 strings follow
 * its working conversion path. Keep this compatibility fix provider-local.
 */
export const ollamaImageInputMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v4',
  transformParams: async ({ params }) => ({
    ...params,
    prompt: params.prompt.map((message) =>
      message.role !== 'user'
        ? message
        : {
            ...message,
            content: message.content.map((part) => {
              if (
                part.type === 'file' &&
                part.mediaType.startsWith('image/') &&
                part.data.type === 'data' &&
                part.data.data instanceof Uint8Array
              ) {
                return {
                  ...part,
                  data: {
                    type: 'data' as const,
                    data: Buffer.from(part.data.data).toString('base64'),
                  },
                };
              }
              return part;
            }),
          }
    ),
  }),
};
