export class EmbeddingCollectionError extends Error {
  constructor(
    public readonly code: 'CONFLICT' | 'PRECONDITION_FAILED' | 'BAD_REQUEST',
    message: string
  ) {
    super(message);
    this.name = 'EmbeddingCollectionError';
  }
}
