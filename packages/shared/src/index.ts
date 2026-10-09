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

/** A passage of the user's documents that an answer was based on. */
export interface ChatSource {
  /** Position in the prompt; the answer cites it as [number]. */
  number: number;
  documentId: string;
  chunkId: string;
  documentTitle: string;
  chunkIndex: number;
  similarity: number;
  /** Beginning of the passage, for display. */
  snippet: string;
  /** Whether the answer actually refers to this source. */
  cited: boolean;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Only on assistant messages. */
  sources: ChatSource[] | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: ChatMessage[];
}

export interface SendMessageInput {
  content: string;
}

export interface SendMessageResult {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}

/** Shape of every error response of the API. */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}
