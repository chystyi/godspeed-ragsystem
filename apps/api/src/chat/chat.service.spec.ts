import { Logger } from '@nestjs/common';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryChatDatabase } from '../../test/in-memory-chat.js';
import type { ChatCompletion, ChatModel, ChatTurn, EmbeddingModel } from '../ai/ai.types.js';
import { AiProviderError } from '../ai/errors.js';
import type { AuthUser } from '../auth/auth.types.js';
import type { ChatConfig } from './chat.config.js';
import { ConversationNotFoundError, type RetrievedChunk } from './chat.repository.js';
import { ChatService, NO_ANSWER_TEXT } from './chat.service.js';

class FakeChat implements ChatModel {
  calls: ChatTurn[][] = [];
  replies: (string | Error)[] = [];
  async complete(messages: ChatTurn[]): Promise<ChatCompletion> {
    this.calls.push(messages);
    const next = this.replies.shift() ?? 'default answer';
    if (next instanceof Error) throw next;
    return { content: next, model: 'fake/chat' };
  }
}

class FakeEmbedder implements EmbeddingModel {
  model = 'fake/embed';
  dimensions = 3;
  queries: string[] = [];
  failWith: Error | undefined;
  async embed(texts: string[]) {
    this.queries.push(...texts);
    if (this.failWith) throw this.failWith;
    return { vectors: texts.map(() => [0.1, 0.2, 0.3]), usage: { totalTokens: 1 } };
  }
}

const alice: AuthUser = { id: 'alice', token: 'alice' };
const config = (over: Partial<ChatConfig> = {}): ChatConfig => ({
  topK: 5,
  minSimilarity: 0.25,
  historyMessages: 10,
  rewriteQueries: true,
  rateLimitPerMinute: 20,
  ...over,
});

const chunk = (n: number, similarity: number, over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  chunkId: `c${n}`,
  documentId: `d${n}`,
  documentTitle: `Doc ${n}`,
  chunkIndex: 0,
  content: `Passage number ${n}.`,
  similarity,
  ...over,
});

let db: InMemoryChatDatabase;
let chat: FakeChat;
let embedder: FakeEmbedder;
const service = (over: Partial<ChatConfig> = {}) =>
  new ChatService(db.factory(), chat, embedder, config(over));

beforeAll(() => {
  Logger.overrideLogger(false);
});
beforeEach(() => {
  db = new InMemoryChatDatabase();
  chat = new FakeChat();
  embedder = new FakeEmbedder();
});

async function start(svc: ChatService, user = alice) {
  return svc.createConversation(user, undefined);
}

describe('ask', () => {
  it('answers from the retrieved passages and reports which ones were cited', async () => {
    db.corpus = [chunk(1, 0.8), chunk(2, 0.6), chunk(3, 0.4)];
    chat.replies = ['The answer is in the first and third passage [1][3].'];
    const svc = service();
    const conversation = await start(svc);
    const { userMessage, assistantMessage } = await svc.ask(alice, conversation.id, 'What is the answer?');

    expect(userMessage).toMatchObject({ role: 'user', content: 'What is the answer?', sources: null });
    expect(assistantMessage.role).toBe('assistant');
    expect(assistantMessage.sources?.map((s) => [s.number, s.documentTitle, s.cited])).toEqual([
      [1, 'Doc 1', true],
      [2, 'Doc 2', false],
      [3, 'Doc 3', true],
    ]);
    expect(assistantMessage.sources?.[0]).toMatchObject({
      documentId: 'd1',
      chunkId: 'c1',
      similarity: 0.8,
      snippet: 'Passage number 1.',
    });
  });

  it('searches with the question embedding, the configured limit and the threshold', async () => {
    db.corpus = Array.from({ length: 8 }, (_, i) => chunk(i, 0.9 - i * 0.05));
    const svc = service({ topK: 3, minSimilarity: 0.5 });
    const conversation = await start(svc);
    await svc.ask(alice, conversation.id, 'question');
    expect(embedder.queries).toEqual(['question']);
    expect(db.searches).toEqual([{ embedding: [0.1, 0.2, 0.3], limit: 3, minSimilarity: 0.5 }]);
  });

  it('puts the passages and the question into the prompt sent to the model', async () => {
    db.corpus = [chunk(1, 0.8)];
    const svc = service();
    const conversation = await start(svc);
    await svc.ask(alice, conversation.id, 'What is it?');
    const prompt = chat.calls[0].at(-1)!.content;
    expect(prompt).toContain('Passage number 1.');
    expect(prompt).toContain('Question: What is it?');
  });

  it('does not call the model when nothing in the documents is related', async () => {
    db.corpus = [chunk(1, 0.1)];
    const svc = service();
    const conversation = await start(svc);
    const { assistantMessage } = await svc.ask(alice, conversation.id, 'Capital of France?');
    expect(chat.calls).toHaveLength(0);
    expect(assistantMessage.content).toBe(NO_ANSWER_TEXT);
    expect(assistantMessage.sources).toEqual([]);
  });

  it('stores question and answer in order and names the conversation after the first question', async () => {
    db.corpus = [chunk(1, 0.8)];
    const svc = service();
    const conversation = await start(svc);
    await svc.ask(alice, conversation.id, 'How do I reset the router?');
    const stored = await svc.getConversation(alice, conversation.id);
    expect(stored.title).toBe('How do I reset the router?');
    expect(stored.messages.map((m) => m.role)).toEqual(['user', 'assistant']);

    await svc.ask(alice, conversation.id, 'Second question');
    const again = await svc.getConversation(alice, conversation.id);
    expect(again.title).toBe('How do I reset the router?'); // only the first question names it
    expect(again.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('keeps a title the user chose', async () => {
    db.corpus = [chunk(1, 0.8)];
    const svc = service();
    const conversation = await svc.createConversation(alice, 'My own title');
    await svc.ask(alice, conversation.id, 'First question');
    expect((await svc.getConversation(alice, conversation.id)).title).toBe('My own title');
  });
});

describe('follow-up questions', () => {
  async function conversationWithHistory(svc: ChatService) {
    db.corpus = [chunk(1, 0.8)];
    const conversation = await start(svc);
    await svc.ask(alice, conversation.id, 'Tell me about the router');
    chat.calls.length = 0;
    embedder.queries.length = 0;
    return conversation;
  }

  it('rewrites the question into a standalone search query and searches with that', async () => {
    const svc = service();
    const conversation = await conversationWithHistory(svc);
    chat.replies = ['how to disable WPS on the router', 'Disable it in the admin page [1].'];
    const { assistantMessage } = await svc.ask(alice, conversation.id, 'and how do I turn it off?');
    expect(embedder.queries).toEqual(['how to disable WPS on the router']);
    expect(chat.calls).toHaveLength(2); // rewrite, then answer
    expect(assistantMessage.content).toBe('Disable it in the admin page [1].');
  });

  it('answers the ORIGINAL question, not the rewritten one', async () => {
    const svc = service();
    const conversation = await conversationWithHistory(svc);
    chat.replies = ['rewritten query'];
    await svc.ask(alice, conversation.id, 'and how do I turn it off?');
    expect(chat.calls[1].at(-1)!.content).toContain('Question: and how do I turn it off?');
  });

  it('sends the earlier turns to the model', async () => {
    const svc = service({ rewriteQueries: false });
    const conversation = await conversationWithHistory(svc);
    await svc.ask(alice, conversation.id, 'next');
    const roles = chat.calls[0].map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
    expect(chat.calls[0][1].content).toBe('Tell me about the router');
  });

  it('skips the rewrite for the first question and when switched off', async () => {
    const first = service();
    db.corpus = [chunk(1, 0.8)];
    const conversation = await start(first);
    await first.ask(alice, conversation.id, 'first');
    expect(chat.calls).toHaveLength(1);

    const off = service({ rewriteQueries: false });
    chat.calls.length = 0;
    await off.ask(alice, conversation.id, 'second');
    expect(chat.calls).toHaveLength(1);
  });

  it('falls back to the original question when the rewrite fails or is empty', async () => {
    const svc = service();
    const conversation = await conversationWithHistory(svc);
    chat.replies = [new AiProviderError('unavailable', 'down', 503), 'answer'];
    await svc.ask(alice, conversation.id, 'and the next one?');
    expect(embedder.queries).toEqual(['and the next one?']);

    embedder.queries.length = 0;
    chat.replies = ['   ', 'answer'];
    await svc.ask(alice, conversation.id, 'and another?');
    expect(embedder.queries).toEqual(['and another?']);
  });

  it('uses only the most recent messages as history', async () => {
    const svc = service({ historyMessages: 2, rewriteQueries: false });
    db.corpus = [chunk(1, 0.8)];
    const conversation = await start(svc);
    for (const q of ['q1', 'q2', 'q3']) await svc.ask(alice, conversation.id, q);
    chat.calls.length = 0;
    await svc.ask(alice, conversation.id, 'q4');
    const history = chat.calls[0].slice(1, -1).map((m) => m.content);
    expect(history).toEqual(['q3', 'default answer']); // the last two messages: q3 and its answer
  });
});

describe('failures', () => {
  it('saves nothing when the model fails, so the user can simply retry', async () => {
    db.corpus = [chunk(1, 0.8)];
    const svc = service();
    const conversation = await start(svc);
    chat.replies = [new AiProviderError('unavailable', 'down', 503)];
    await expect(svc.ask(alice, conversation.id, 'q')).rejects.toBeInstanceOf(AiProviderError);
    expect((await svc.getConversation(alice, conversation.id)).messages).toEqual([]);
    expect((await svc.getConversation(alice, conversation.id)).title).toBe('New conversation');
  });

  it('saves nothing when the embedding fails', async () => {
    const svc = service();
    const conversation = await start(svc);
    embedder.failWith = new AiProviderError('rate_limited', 'slow down', 429);
    await expect(svc.ask(alice, conversation.id, 'q')).rejects.toBeInstanceOf(AiProviderError);
    expect(db.messages).toHaveLength(0);
  });

  it("does not reveal or touch another user's conversation", async () => {
    const svc = service();
    const conversation = await start(svc);
    const bob: AuthUser = { id: 'bob', token: 'bob' };
    await expect(svc.ask(bob, conversation.id, 'q')).rejects.toBeInstanceOf(ConversationNotFoundError);
    await expect(svc.getConversation(bob, conversation.id)).rejects.toBeInstanceOf(ConversationNotFoundError);
    await expect(svc.deleteConversation(bob, conversation.id)).rejects.toBeInstanceOf(ConversationNotFoundError);
    expect(embedder.queries).toEqual([]); // not even the provider was called
  });
});

describe('conversations', () => {
  it('lists newest activity first and deletes with the messages', async () => {
    db.corpus = [chunk(1, 0.8)];
    const svc = service();
    const first = await svc.createConversation(alice, 'first');
    const second = await svc.createConversation(alice, 'second');
    await svc.ask(alice, first.id, 'activity');
    expect((await svc.listConversations(alice)).map((c) => c.id)).toEqual([first.id, second.id]);
    await svc.deleteConversation(alice, first.id);
    expect((await svc.listConversations(alice)).map((c) => c.id)).toEqual([second.id]);
    expect(db.messages).toHaveLength(0);
  });
});
