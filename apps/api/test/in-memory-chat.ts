import { randomUUID } from 'node:crypto';
import type { ChatMessage, ChatSource, Conversation } from '@kb/shared';
import {
  type ChatRepository,
  type ChatRepositoryFactory,
  ConversationNotFoundError,
  type RetrievedChunk,
} from '../src/chat/chat.repository.js';

interface StoredConversation extends Conversation {
  userId: string;
}
interface StoredMessage extends ChatMessage {
  conversationId: string;
}

/** What the search returns, and what it was asked, so tests can script and inspect it. */
export class InMemoryChatDatabase {
  conversations: StoredConversation[] = [];
  messages: StoredMessage[] = [];
  /** Passages the "vector search" finds; the search applies the threshold and limit itself. */
  corpus: RetrievedChunk[] = [];
  searches: { embedding: number[]; limit: number; minSimilarity: number }[] = [];
  private clock = 0;

  tick(): string {
    return new Date(Date.UTC(2026, 9, 9, 12, 0, ++this.clock)).toISOString();
  }

  repositoryFor(userId: string): ChatRepository {
    return new InMemoryChatRepository(this, userId);
  }

  factory(): ChatRepositoryFactory {
    return { forUser: (token) => this.repositoryFor(token) };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class InMemoryChatRepository implements ChatRepository {
  constructor(
    private readonly db: InMemoryChatDatabase,
    private readonly userId: string,
  ) {}

  private own(): StoredConversation[] {
    return this.db.conversations.filter((c) => c.userId === this.userId);
  }

  private strip({ userId: _u, ...conversation }: StoredConversation): Conversation {
    return conversation;
  }

  async createConversation(title = 'New conversation'): Promise<Conversation> {
    const now = this.db.tick();
    const conversation = { id: randomUUID(), userId: this.userId, title, createdAt: now, updatedAt: now };
    this.db.conversations.push(conversation);
    return this.strip(conversation);
  }

  async listConversations(): Promise<Conversation[]> {
    return this.own()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((c) => this.strip(c));
  }

  async findConversation(id: string): Promise<Conversation | null> {
    if (!UUID.test(id)) throw new Error(`invalid input syntax for type uuid: "${id}"`);
    const found = this.own().find((c) => c.id === id);
    return found ? this.strip(found) : null;
  }

  async deleteConversation(id: string): Promise<boolean> {
    const before = this.db.conversations.length;
    this.db.conversations = this.db.conversations.filter((c) => !(c.id === id && c.userId === this.userId));
    this.db.messages = this.db.messages.filter((m) => m.conversationId !== id);
    return this.db.conversations.length < before;
  }

  async allMessages(conversationId: string): Promise<ChatMessage[]> {
    return this.db.messages
      .filter((m) => m.conversationId === conversationId && this.own().some((c) => c.id === conversationId))
      .map(({ conversationId: _c, ...message }) => message);
  }

  async recentMessages(conversationId: string, limit: number): Promise<ChatMessage[]> {
    const all = await this.allMessages(conversationId);
    return limit === 0 ? [] : all.slice(-limit);
  }

  async appendExchange(args: {
    conversationId: string;
    question: string;
    answer: string;
    sources: ChatSource[];
    newTitle?: string;
  }) {
    const conversation = this.own().find((c) => c.id === args.conversationId);
    if (!conversation) throw new ConversationNotFoundError(args.conversationId);
    const make = (role: 'user' | 'assistant', content: string, sources: ChatSource[] | null): StoredMessage => ({
      id: randomUUID(),
      conversationId: args.conversationId,
      role,
      content,
      sources,
      createdAt: this.db.tick(),
    });
    const user = make('user', args.question, null);
    const assistant = make('assistant', args.answer, args.sources);
    this.db.messages.push(user, assistant);
    if (args.newTitle) conversation.title = args.newTitle;
    conversation.updatedAt = this.db.tick();
    const strip = ({ conversationId: _c, ...message }: StoredMessage): ChatMessage => message;
    return { userMessage: strip(user), assistantMessage: strip(assistant) };
  }

  async searchChunks(embedding: number[], limit: number, minSimilarity: number): Promise<RetrievedChunk[]> {
    this.db.searches.push({ embedding, limit, minSimilarity });
    return this.db.corpus
      .filter((c) => c.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
}
