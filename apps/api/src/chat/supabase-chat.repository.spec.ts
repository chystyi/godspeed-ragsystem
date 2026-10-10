import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { argsOf, fakeSupabase, methodsOf } from '../../test/fake-supabase.js';
import { LimitReachedError } from '../http/limit-error.js';
import { ConversationNotFoundError } from './chat.repository.js';
import { SupabaseChatRepositoryFactory } from './supabase-chat.repository.js';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

const config = { url: 'https://example.supabase.co', anonKey: 'anon-key' };

function repository(...results: Parameters<typeof fakeSupabase>) {
  const fake = fakeSupabase(...results);
  vi.mocked(createClient).mockReturnValue(fake.client as never);
  return { repository: new SupabaseChatRepositoryFactory(config).forUser('user-jwt'), fake };
}

beforeEach(() => vi.mocked(createClient).mockReset());

const conversationRow = { id: 'c1', title: 'Hello', created_at: '2026-10-09T10:00:00Z', updated_at: '2026-10-09T11:00:00Z' };
const message = (n: number, role: 'user' | 'assistant', sources: unknown = null) => ({
  id: `m${n}`,
  role,
  content: `text ${n}`,
  sources,
  created_at: `2026-10-09T10:0${n}:00Z`,
});

describe('chat repository', () => {
  it("uses the user's own token", () => {
    repository();
    expect(createClient).toHaveBeenCalledWith(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: 'Bearer user-jwt' } },
    });
  });

  it('creates a conversation with the database default title unless one is given', async () => {
    const plain = repository({ data: conversationRow });
    const created = await plain.repository.createConversation();
    expect(created).toEqual({ id: 'c1', title: 'Hello', createdAt: '2026-10-09T10:00:00Z', updatedAt: '2026-10-09T11:00:00Z' });
    expect(argsOf(plain.fake.calls[0], 'insert')).toEqual([{}]);

    const named = repository({ data: conversationRow });
    await named.repository.createConversation('Taxes');
    expect(argsOf(named.fake.calls[0], 'insert')).toEqual([{ title: 'Taxes' }]);
  });

  it('turns the per-user conversation cap into a limit error', async () => {
    const { repository: repo } = repository({ error: { message: 'conversations limit of 200 reached', code: 'P0004' } });
    await expect(repo.createConversation()).rejects.toBeInstanceOf(LimitReachedError);
  });

  it('lists the newest conversations first', async () => {
    const { repository: repo, fake } = repository({ data: [conversationRow] });
    expect(await repo.listConversations()).toHaveLength(1);
    expect(argsOf(fake.calls[0], 'order')).toEqual(['updated_at', { ascending: false }]);
  });

  it('finds a conversation or answers null', async () => {
    expect((await repository({ data: conversationRow }).repository.findConversation('c1'))?.id).toBe('c1');
    expect(await repository({ data: null }).repository.findConversation('c1')).toBeNull();
  });

  it('delete reports whether a row was removed', async () => {
    expect(await repository({ data: [{ id: 'c1' }] }).repository.deleteConversation('c1')).toBe(true);
    expect(await repository({ data: [] }).repository.deleteConversation('c1')).toBe(false);
  });

  it('returns the newest messages oldest first, ordered by the sequence number', async () => {
    // the database returns newest first because of `limit`; the repository must flip them
    const { repository: repo, fake } = repository({ data: [message(3, 'assistant'), message(2, 'user')] });
    const messages = await repo.recentMessages('c1', 2);
    expect(messages.map((m) => m.id)).toEqual(['m2', 'm3']);
    expect(argsOf(fake.calls[0], 'order')).toEqual(['seq', { ascending: false }]);
    expect(argsOf(fake.calls[0], 'limit')).toEqual([2]);
  });

  it('does not query at all when no history is wanted', async () => {
    const { repository: repo, fake } = repository();
    expect(await repo.recentMessages('c1', 0)).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });

  it('loads a whole conversation in order with the sources attached', async () => {
    const sources = [{ number: 1 }];
    const { repository: repo, fake } = repository({ data: [message(1, 'user'), message(2, 'assistant', sources)] });
    const messages = await repo.allMessages('c1');
    expect(messages[1]).toMatchObject({ role: 'assistant', sources });
    expect(argsOf(fake.calls[0], 'order')).toEqual(['seq', { ascending: true }]);
  });

  it('stores an exchange through the atomic function and returns both messages', async () => {
    const { repository: repo, fake } = repository({ data: [message(1, 'user'), message(2, 'assistant', [])] });
    const result = await repo.appendExchange({
      conversationId: 'c1',
      question: 'q',
      answer: 'a',
      sources: [],
      newTitle: 'q',
    });
    expect(result.userMessage.role).toBe('user');
    expect(result.assistantMessage.role).toBe('assistant');
    expect(fake.calls[0]).toMatchObject({
      kind: 'rpc',
      name: 'append_exchange',
      args: { p_conversation_id: 'c1', p_user_content: 'q', p_assistant_content: 'a', p_sources: [], p_new_title: 'q' },
    });
  });

  it('sends no title change when the conversation already has one', async () => {
    const { repository: repo, fake } = repository({ data: [message(1, 'user'), message(2, 'assistant', [])] });
    await repo.appendExchange({ conversationId: 'c1', question: 'q', answer: 'a', sources: [] });
    expect((fake.calls[0].args as { p_new_title: unknown }).p_new_title).toBeNull();
  });

  it('maps "no such conversation" to ConversationNotFoundError and keeps other errors visible', async () => {
    const missing = repository({ error: { message: 'conversation x not found', code: 'P0002' } });
    await expect(
      missing.repository.appendExchange({ conversationId: 'c1', question: 'q', answer: 'a', sources: [] }),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);
    const broken = repository({ error: { message: 'boom', code: 'XX000' } });
    await expect(
      broken.repository.appendExchange({ conversationId: 'c1', question: 'q', answer: 'a', sources: [] }),
    ).rejects.toThrow(/saving the exchange failed/);
  });

  it('refuses an unexpected result instead of returning half an exchange', async () => {
    const { repository: repo } = repository({ data: [message(1, 'user')] });
    await expect(
      repo.appendExchange({ conversationId: 'c1', question: 'q', answer: 'a', sources: [] }),
    ).rejects.toThrow(/unexpected result/);
  });

  it('searches with the embedding as JSON text and maps the matches', async () => {
    const { repository: repo, fake } = repository({
      data: [{ chunk_id: 'k1', document_id: 'd1', document_title: 'Guide', chunk_index: 2, content: 'text', similarity: 0.7 }],
    });
    const found = await repo.searchChunks([0.1, 0.2], 5, 0.25);
    expect(found).toEqual([{ chunkId: 'k1', documentId: 'd1', documentTitle: 'Guide', chunkIndex: 2, content: 'text', similarity: 0.7 }]);
    expect(fake.calls[0]).toMatchObject({
      kind: 'rpc',
      name: 'match_chunks',
      args: { query_embedding: '[0.1,0.2]', match_count: 5, min_similarity: 0.25 },
    });
    expect(methodsOf(fake.calls[0])).toEqual([]);
  });
});
