export class DocumentNotFoundError extends Error {
  constructor(readonly documentId: string) {
    super(`document ${documentId} not found`);
    this.name = 'DocumentNotFoundError';
  }
}

/** The document was edited while an indexing run was embedding the older text. */
export class StaleIndexError extends Error {
  constructor(readonly documentId: string) {
    super(`document ${documentId} changed while it was being indexed`);
    this.name = 'StaleIndexError';
  }
}
