export class DocumentNotFoundError extends Error {
  constructor(readonly documentId: string) {
    super(`document ${documentId} not found`);
    this.name = 'DocumentNotFoundError';
  }
}
