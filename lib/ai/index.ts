import 'server-only';

export { AiError, type AiErrorCode } from './errors';
export {
  discoverModels,
  resolveChatModel,
  resolveEmbeddingModel,
  type AiModel,
  type AiModelCapability,
  type AiModelSelection,
} from './ollama';
