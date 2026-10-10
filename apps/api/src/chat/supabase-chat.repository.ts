import type { ChatMessage, ChatSource, Conversation } from '@kb/shared';
import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import { LimitReachedError, ROW_LIMIT_SQLSTATE } from '../http/limit-error.js';
import type { SupabaseConfig } from '../supabase/supabase.config.js';
import {
  type ChatRepository,
  type ChatRepositoryFactory,
  ConversationNotFoundError,
  type RetrievedChunk,
} from './chat.repository.js';

const CONVERSATION_COLUMNS = 'id, title, created_at, updated_at';
const MESSAGE_COLUMNS = 'id, role, content, sources, created_at';
/** Upper bound for one conversation view; a longer history is a documented follow-up. */
const MAX_MESSAGES = 500;

interface ConversationRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  role: ChatMessage['role'];
  content: string;
  sources: ChatSource[] | null;
  created_at: string;
}

interface MatchRow {
  chunk_id: string;
  document_id: string;
  document_title: string;
  chunk_index: number;
  content: string;
  similarity: number;
}

const toConversation = (row: ConversationRow): Conversation => ({
  id: row.id,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toMessage = (row: MessageRow): ChatMessage => ({
  id: row.id,
  role: row.role,
  content: row.content,
  sources: row.sources,
  createdAt: row.created_at,
});

function fail(operation: string, error: PostgrestError): never {
  throw new Error(`${operation} failed: ${error.message} (${error.code})`);
}

/** Uses the USER'S token; row level security restricts every query to their rows. */
class SupabaseChatRepository implements ChatRepository {
  constructor(private readonly client: SupabaseClient) {}

  async createConversation(title?: string): Promise<Conversation> {
    const { data, error } = await this.client
      .from('conversations')
      .insert(title ? { title } : {})
      .select(CONVERSATION_COLUMNS)
      .single();
    if (error?.code === ROW_LIMIT_SQLSTATE) throw new LimitReachedError('conversations', 200);
    if (error) fail('creating the conversation', error);
    return toConversation(data as unknown as ConversationRow);
  }

  async listConversations(): Promise<Conversation[]> {
    const { data, error } = await this.client
      .from('conversations')
      .select(CONVERSATION_COLUMNS)
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) fail('listing conversations', error);
    return (data as unknown as ConversationRow[]).map(toConversation);
  }

  async findConversation(id: string): Promise<Conversation | null> {
    const { data, error } = await this.client
      .from('conversations')
      .select(CONVERSATION_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) fail('loading the conversation', error);
    return data ? toConversation(data as unknown as ConversationRow) : null;
  }

  async deleteConversation(id: string): Promise<boolean> {
    const { data, error } = await this.client.from('conversations').delete().eq('id', id).select('id');
    if (error) fail('deleting the conversation', error);
    return data.length > 0;
  }

  async recentMessages(conversationId: string, limit: number): Promise<ChatMessage[]> {
    if (limit <= 0) return [];
    const { data, error } = await this.client
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', conversationId)
      .order('seq', { ascending: false })
      .limit(limit);
    if (error) fail('loading recent messages', error);
    return (data as unknown as MessageRow[]).reverse().map(toMessage);
  }

  async allMessages(conversationId: string): Promise<ChatMessage[]> {
    const { data, error } = await this.client
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', conversationId)
      .order('seq', { ascending: true })
      .limit(MAX_MESSAGES);
    if (error) fail('loading messages', error);
    return (data as unknown as MessageRow[]).map(toMessage);
  }

  async appendExchange(args: {
    conversationId: string;
    question: string;
    answer: string;
    sources: ChatSource[];
    newTitle?: string;
  }): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage }> {
    const { data, error } = await this.client.rpc('append_exchange', {
      p_conversation_id: args.conversationId,
      p_user_content: args.question,
      p_assistant_content: args.answer,
      p_sources: args.sources,
      p_new_title: args.newTitle ?? null,
    });
    if (error?.code === 'P0002') throw new ConversationNotFoundError(args.conversationId);
    if (error) fail('saving the exchange', error);
    const rows = data as unknown as MessageRow[];
    const user = rows.find((row) => row.role === 'user');
    const assistant = rows.find((row) => row.role === 'assistant');
    if (!user || !assistant) throw new Error('saving the exchange returned an unexpected result');
    return { userMessage: toMessage(user), assistantMessage: toMessage(assistant) };
  }

  async searchChunks(
    embedding: number[],
    limit: number,
    minSimilarity: number,
  ): Promise<RetrievedChunk[]> {
    const { data, error } = await this.client.rpc('match_chunks', {
      query_embedding: JSON.stringify(embedding),
      match_count: limit,
      min_similarity: minSimilarity,
    });
    if (error) fail('searching the documents', error);
    return (data as unknown as MatchRow[]).map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      documentTitle: row.document_title,
      chunkIndex: row.chunk_index,
      content: row.content,
      similarity: row.similarity,
    }));
  }
}

export class SupabaseChatRepositoryFactory implements ChatRepositoryFactory {
  constructor(private readonly config: SupabaseConfig) {}

  forUser(accessToken: string): ChatRepository {
    return new SupabaseChatRepository(
      createClient(this.config.url, this.config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      }),
    );
  }
}
