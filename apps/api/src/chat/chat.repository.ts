import type { ChatMessage, ChatSource, Conversation } from '@kb/shared';

/** A passage found by the vector search. */
export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

/**
 * Persistence and search port, scoped to ONE user (row level security does the scoping in
 * the Supabase implementation).
 */
export interface ChatRepository {
  createConversation(title?: string): Promise<Conversation>;
  listConversations(): Promise<Conversation[]>;
  findConversation(id: string): Promise<Conversation | null>;
  deleteConversation(id: string): Promise<boolean>;
  /** The newest `limit` messages, oldest first. */
  recentMessages(conversationId: string, limit: number): Promise<ChatMessage[]>;
  /** Every message of a conversation, oldest first. */
  allMessages(conversationId: string): Promise<ChatMessage[]>;
  /** Stores the question and its answer together or not at all. */
  appendExchange(args: {
    conversationId: string;
    question: string;
    answer: string;
    sources: ChatSource[];
    newTitle?: string;
  }): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage }>;
  searchChunks(embedding: number[], limit: number, minSimilarity: number): Promise<RetrievedChunk[]>;
}

export interface ChatRepositoryFactory {
  forUser(accessToken: string): ChatRepository;
}

export const CHAT_REPOSITORY_FACTORY = Symbol('CHAT_REPOSITORY_FACTORY');

export class ConversationNotFoundError extends Error {
  constructor(readonly conversationId: string) {
    super(`conversation ${conversationId} not found`);
    this.name = 'ConversationNotFoundError';
  }
}
