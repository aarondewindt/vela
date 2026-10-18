import 'server-only';

export { AiError, type AiErrorCode } from './errors';
export { generateStructured } from './structured';
export {
  discoverModels,
  resolveChatModel,
  resolveEmbeddingModel,
  resolveEmbeddingModelWithIdentity,
  type AiModel,
  type AiModelCapability,
  type AiModelSelection,
} from './ollama';
