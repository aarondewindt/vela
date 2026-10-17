export type AiErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'PROVIDER_NOT_SUPPORTED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_NOT_SUPPORTED';

export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AiError';
  }
}
