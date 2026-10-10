import type {
  ChatMessage,
  ChatSource,
  ChatStreamEvent,
  Conversation,
  ConversationWithMessages,
  SendMessageResult,
} from '@kb/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CHAT_MODEL,
  type ChatModel,
  type ChatTurn,
  EMBEDDING_MODEL,
  type EmbeddingModel,
} from '../ai/ai.types.js';
import { AiProviderError } from '../ai/errors.js';
import { truncate } from '../text.js';
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
const ANSWER_TEMPERATURE = 0.2;
const MAX_REWRITTEN_QUERY_CHARS = 300;

interface AskContext {
  repository: ChatRepository;
  conversationId: string;
  passages: RetrievedChunk[];
  messages: ChatTurn[];
  /** The first question of an untitled conversation becomes its title. */
  namesConversation: boolean;
}

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
    const context = (await this.prepare(user, conversationId, question)) as AskContext; // no signal: never null
    let answer = NO_ANSWER_TEXT;
    if (context.passages.length > 0) {
      answer = (await this.chat.complete(context.messages, { temperature: ANSWER_TEMPERATURE })).content;
    }
    return this.save(context, question, answer);
  }

  /**
   * The same answer, delivered as it is written: `start` (the sources), `delta` parts and
   * finally `done` with the stored messages. Nothing is stored unless the whole answer
   * arrived, and a cancelled request (`signal`) ends quietly without saving. Failures are
   * thrown; one that happens before the first event is a plain error for the caller.
   */
  async *askStream(
    user: AuthUser,
    conversationId: string,
    question: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    let context: AskContext | null;
    try {
      context = await this.prepare(user, conversationId, question, signal);
    } catch (error) {
      if (signal?.aborted) return; // the client left; a failure caused by that is not worth reporting
      throw error;
    }
    if (!context) return;
    const sources = toSources(context.passages, '');
    let answer = '';

    if (context.passages.length === 0) {
      answer = NO_ANSWER_TEXT;
      yield { type: 'start', sources };
      yield { type: 'delta', text: answer };
    } else {
      const parts = this.chat
        .stream(context.messages, { temperature: ANSWER_TEMPERATURE, signal })
        [Symbol.asyncIterator]();
      try {
        // Wait for the first part before announcing anything: a provider that rejects the
        // request (bad key, rate limit) then fails like a normal request.
        const first = await parts.next();
        if (first.done) {
          if (signal?.aborted) return; // cancelled before the first word: nothing to report
          throw new AiProviderError('invalid_response', 'chat stream returned no content');
        }
        yield { type: 'start', sources };
        answer = first.value;
        yield { type: 'delta', text: first.value };
        for (let next = await parts.next(); !next.done; next = await parts.next()) {
          if (signal?.aborted) break;
          answer += next.value;
          yield { type: 'delta', text: next.value };
        }
      } finally {
        await parts.return?.(undefined); // stop the provider stream if we leave early
      }
    }

    if (signal?.aborted) return;
    yield { type: 'done', ...(await this.save(context, question, answer)) };
  }

  /** Everything both kinds of answer need before the model is called. */
  private async prepare(
    user: AuthUser,
    conversationId: string,
    question: string,
    signal?: AbortSignal,
  ): Promise<AskContext | null> {
    const repository = this.repositories.forUser(user.token);
    const conversation = await this.requireConversation(repository, conversationId);
    const history = await repository.recentMessages(conversationId, this.config.historyMessages);
    const turns: HistoryTurn[] = history.map(({ role, content }) => ({ role, content }));

    if (signal?.aborted) return null;
    const searchQuery = await this.standaloneQuery(turns, question, signal);
    if (signal?.aborted) return null;
    const { vectors } = await this.embedder.embed([searchQuery], { signal });
    if (signal?.aborted) return null;
    const passages = await repository.searchChunks(
      vectors[0],
      this.config.topK,
      this.config.minSimilarity,
    );
    const messages = buildAnswerMessages({
      question,
      history: turns,
      sources: passages.map((passage, i) => ({
        number: i + 1,
        title: passage.documentTitle,
        content: passage.content,
      })),
    });
    return {
      repository,
      conversationId,
      passages,
      messages,
      namesConversation:
        history.length === 0 && conversation.title === DEFAULT_CONVERSATION_TITLE,
    };
  }

  private save(context: AskContext, question: string, answer: string): Promise<SendMessageResult> {
    return context.repository.appendExchange({
      conversationId: context.conversationId,
      question,
      answer,
      sources: toSources(context.passages, answer),
      newTitle: context.namesConversation ? titleFromQuestion(question) : undefined,
    });
  }

  private async requireConversation(repository: ChatRepository, id: string): Promise<Conversation> {
    const conversation = await repository.findConversation(id);
    if (!conversation) throw new ConversationNotFoundError(id);
    return conversation;
  }

  /** The text to search with: a follow-up is first turned into a self-contained question. */
  private async standaloneQuery(history: HistoryTurn[], question: string, signal?: AbortSignal): Promise<string> {
    if (!this.config.rewriteQueries || history.length === 0) return question;
    try {
      const rewritten = (await this.chat.complete(buildRewriteMessages(history, question), {
        temperature: 0,
        maxTokens: 100,
        signal,
      })).content.trim();
      return rewritten ? truncate(rewritten, MAX_REWRITTEN_QUERY_CHARS) : question;
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
    snippet: truncate(passage.content, SNIPPET_CHARS),
    cited: cited.has(i + 1),
  }));
}

export type { ChatMessage };
