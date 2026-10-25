import 'server-only';
import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai';
import { modelInputSupport, type AiModel } from './capabilities';
import { AiError } from './errors';

/** Guard both generation and streaming, including images in restored history. */
export function guardModelInputs(
  model: Parameters<typeof wrapLanguageModel>[0]['model'],
  metadata: AiModel
) {
  const support = modelInputSupport(metadata);
  const middleware: LanguageModelMiddleware = {
    specificationVersion: 'v4',
    transformParams: async ({ params }) => {
      const hasImages = params.prompt.some(
        (message) =>
          message.role === 'user' &&
          message.content.some(
            (part) => part.type === 'file' && part.mediaType.startsWith('image/')
          )
      );
      if (hasImages && !support.image) {
        throw new AiError(
          'MODEL_NOT_SUPPORTED',
          'The selected model does not support image inputs. Select a vision-language model or remove the images.'
        );
      }
      return params;
    },
  };
  return wrapLanguageModel({ model, middleware });
}
