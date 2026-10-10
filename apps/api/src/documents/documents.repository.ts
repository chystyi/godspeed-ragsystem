import type { IndexingStatus, KbDocument, KbDocumentSummary } from '@kb/shared';

/** A stored document plus bookkeeping the API does not expose. */
export interface DocumentRecord extends KbDocument {
  contentHash: string | null;
}

export type DocumentListItem = KbDocumentSummary;

export interface NewDocument {
  title: string;
  content: string;
  tags: string[];
}

export type DocumentPatch = Partial<NewDocument>;

export interface ChunkToStore {
  index: number;
  content: string;
  tokenCount: number;
  embedding: number[];
}

export interface ReplaceChunksArgs {
  embeddingModel: string;
  contentHash: string;
  /** Fingerprint of the title and text that were embedded (see digest.ts). */
  contentDigest: string;
  chunks: ChunkToStore[];
}

export type { IndexingStatus };

/**
 * Persistence port, scoped to ONE user: every method only ever sees that user's rows.
 * The Supabase implementation gets this from row level security, not from `where` clauses.
 */
export interface DocumentsRepository {
  create(input: NewDocument): Promise<DocumentRecord>;
  findById(id: string): Promise<DocumentRecord | null>;
  list(): Promise<DocumentListItem[]>;
  /** Returns null when the document does not exist (for this user). */
  update(id: string, patch: DocumentPatch): Promise<DocumentRecord | null>;
  /** Returns false when the document does not exist (for this user). */
  delete(id: string): Promise<boolean>;
  /**
   * Atomically swaps all chunks and marks the document indexed. Throws StaleIndexError when the
   * document changed since `contentDigest` was taken.
   */
  replaceChunks(id: string, args: ReplaceChunksArgs): Promise<void>;
  /** Records a failure; ignored when the document changed since `contentDigest` was taken. */
  markIndexingFailed(id: string, message: string, contentDigest: string): Promise<void>;
}

export interface DocumentsRepositoryFactory {
  /** `accessToken` is the signed-in user's JWT. */
  forUser(accessToken: string): DocumentsRepository;
}

export const DOCUMENTS_REPOSITORY_FACTORY = Symbol('DOCUMENTS_REPOSITORY_FACTORY');
