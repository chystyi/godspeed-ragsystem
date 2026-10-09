import type {
  ChatMessage,
  ChatSource,
  Conversation,
  ConversationWithMessages,
  SendMessageResult,
} from '@kb/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CHAT_MODEL,
  type ChatModel,
  EMBEDDING_MODEL,
  type EmbeddingModel,
} from '../ai/ai.types.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CHAT_CONFIG, type ChatConfig } from './chat.config.js';
import {
  CHAT_REPOSITORY_FACTORY,
  type ChatRepository,
  type ChatRepositoryFactory,
  ConversationNotFoundError,
  type RetrievedChunk,
} from './chat.repository.js';
import {
  buildAnswerMessages,
  buildRewriteMessages,
  citedNumbers,
  type HistoryTurn,
  titleFromQuestion,
} from './prompt.js';

export const DEFAULT_CONVERSATION_TITLE = 'New conversation';

/** Said without asking the model: nothing in the documents is related to the question. */
export const NO_ANSWER_TEXT =
  "I couldn't find anything about that in your documents. Try rephrasing the question, or add a document that covers it.";

const SNIPPET_CHARS = 200;
const MAX_REWRITTEN_QUERY_CHARS = 300;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(CHAT_REPOSITORY_FACTORY) private readonly repositories: ChatRepositoryFactory,
    @Inject(CHAT_MODEL) private readonly chat: ChatModel,
    @Inject(EMBEDDING_MODEL) private readonly embedder: EmbeddingModel,
    @Inject(CHAT_CONFIG) private readonly config: ChatConfig,
  ) {}

  createConversation(user: AuthUser, title: string | undefined): Promise<Conversation> {
    return this.repositories.forUser(user.token).createConversation(title);
  }

  listConversations(user: AuthUser): Promise<Conversation[]> {
    return this.repositories.forUser(user.token).listConversations();
  }

  async getConversation(user: AuthUser, id: string): Promise<ConversationWithMessages> {
    const repository = this.repositories.forUser(user.token);
    const conversation = await this.requireConversation(repository, id);
    return { ...conversation, messages: await repository.allMessages(id) };
  }

  async deleteConversation(user: AuthUser, id: string): Promise<void> {
    if (!(await this.repositories.forUser(user.token).deleteConversation(id))) {
      throw new ConversationNotFoundError(id);
    }
  }

  /**
   * Retrieval-augmented answer: find the user's passages that relate to the question, let
   * the model answer from them only, and store question and answer together. If anything
   * fails before the answer exists, nothing is saved and the user can simply ask again.
   */
  async ask(user: AuthUser, conversationId: string, question: string): Promise<SendMessageResult> {
    const repository = this.repositories.forUser(user.token);
    const conversation = await this.requireConversation(repository, conversationId);
    const history = await repository.recentMessages(conversationId, this.config.historyMessages);
    const turns: HistoryTurn[] = history.map(({ role, content }) => ({ role, content }));

    const searchQuery = await this.standaloneQuery(turns, question);
    const { vectors } = await this.embedder.embed([searchQuery]);
    const passages = await repository.searchChunks(
      vectors[0],
      this.config.topK,
      this.config.minSimilarity,
    );

    let answer = NO_ANSWER_TEXT;
    let sources: ChatSource[] = [];
    if (passages.length > 0) {
      const completion = await this.chat.complete(
        buildAnswerMessages({
          question,
          history: turns,
          sources: passages.map((passage, i) => ({
            number: i + 1,
            title: passage.documentTitle,
            content: passage.content,
          })),
        }),
        { temperature: 0.2 },
      );
      answer = completion.content;
      sources = toSources(passages, answer);
    }

    const isFirstQuestion = history.length === 0;
    return repository.appendExchange({
      conversationId,
      question,
      answer,
      sources,
      newTitle:
        isFirstQuestion && conversation.title === DEFAULT_CONVERSATION_TITLE
          ? titleFromQuestion(question)
          : undefined,
    });
  }

  private async requireConversation(repository: ChatRepository, id: string): Promise<Conversation> {
    const conversation = await repository.findConversation(id);
    if (!conversation) throw new ConversationNotFoundError(id);
    return conversation;
  }

  /** The text to search with: a follow-up is first turned into a self-contained question. */
  private async standaloneQuery(history: HistoryTurn[], question: string): Promise<string> {
    if (!this.config.rewriteQueries || history.length === 0) return question;
    try {
      const rewritten = (await this.chat.complete(buildRewriteMessages(history, question), {
        temperature: 0,
        maxTokens: 100,
      })).content.trim();
      return rewritten ? rewritten.slice(0, MAX_REWRITTEN_QUERY_CHARS) : question;
    } catch (error) {
      // The rewrite only improves search; the original question still works.
      this.logger.warn(`query rewrite failed, searching with the original question: ${String(error)}`);
      return question;
    }
  }
}

function toSources(passages: RetrievedChunk[], answer: string): ChatSource[] {
  const cited = new Set(citedNumbers(answer, passages.length));
  return passages.map((passage, i) => ({
    number: i + 1,
    documentId: passage.documentId,
    chunkId: passage.chunkId,
    documentTitle: passage.documentTitle,
    chunkIndex: passage.chunkIndex,
    similarity: passage.similarity,
    snippet: passage.content.slice(0, SNIPPET_CHARS),
    cited: cited.has(i + 1),
  }));
}

export type { ChatMessage };
