/** Types shared by the API and the web app. Single source of truth for the contract. */

export type IndexingStatus = "pending" | "indexed" | "failed";

export interface KbDocument {
  id: string;
  title: string;
  content: string;
  tags: string[];
  /** Whether the document is searchable. A failed indexing never loses the document. */
  indexingStatus: IndexingStatus;
  indexingError: string | null;
  indexedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What lists show: everything except the full text. */
export type KbDocumentSummary = Omit<KbDocument, "content"> & { preview: string };

export interface CreateDocumentInput {
  title: string;
  content: string;
  tags?: string[];
}

export type UpdateDocumentInput = Partial<CreateDocumentInput>;

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

/** Shape of every error response of the API. */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}
