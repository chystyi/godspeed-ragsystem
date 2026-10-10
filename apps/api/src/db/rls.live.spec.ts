import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LiveUsers } from '../../test/live-users.js';
import { loadRootEnv } from '../config/load-env.js';
import { documentDigest } from '../documents/digest.js';

// Opt-in: runs against the real Supabase project from .env. It creates two throw-away users
// and deletes them afterwards (their rows disappear through ON DELETE CASCADE).
//   RUN_LIVE_DB=1 npm run test -w @kb/api -- rls.live
const live = !!process.env.RUN_LIVE_DB;
const DIM = 1536;

/** A unit vector along one axis: cosine similarity between different axes is exactly 0. */
function axis(i: number): number[] {
  const v = Array.from({ length: DIM }, () => 0);
  v[i] = 1;
  return v;
}

describe.skipIf(!live)('database isolation and retrieval (live)', () => {
  loadRootEnv();
  const url = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_ANON_KEY!;
  const users = new LiveUsers(url, anonKey, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const admin = users.admin;
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceId = '';
  let bobId = '';
  let docId = '';

  /** Run SQL as the database owner through the Supabase management API. */
  async function sql(query: string): Promise<unknown> {
    const ref = new URL(url).hostname.split('.')[0];
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    if (!response.ok) throw new Error(`management API ${response.status}: ${await response.text()}`);
    return response.json();
  }

  const chunks = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      index: i,
      content: `chunk ${i}`,
      tokenCount: 2,
      embedding: axis(i),
    }));

  /** Index through the database function, with the fingerprint of the document as it is now. */
  async function indexAs(
    client: SupabaseClient,
    id: string,
    hash: string,
    list: ReturnType<typeof chunks> = chunks(1),
    digest?: string,
  ) {
    const doc = (await client.from('documents').select('title, content').eq('id', id).single()).data;
    return client.rpc('replace_document_chunks', {
      p_document_id: id,
      p_embedding_model: 'test/model',
      p_content_hash: hash,
      p_content_digest: digest ?? documentDigest(doc?.title ?? '', doc?.content ?? ''),
      p_chunks: list,
    });
  }

  beforeAll(async () => {
    ({ client: alice, id: aliceId } = await users.signUp('alice'));
    ({ client: bob, id: bobId } = await users.signUp('bob'));
    const inserted = await alice
      .from('documents')
      .insert({ title: 'Alice notes', content: 'secret plans', tags: ['x'] })
      .select()
      .single();
    expect(inserted.error).toBeNull();
    docId = inserted.data.id;
  }, 60000);

  afterAll(async () => {
    await users.cleanup();
  }, 60000);

  it('fills user_id from the token, so clients cannot forget or fake it', async () => {
    const { data } = await alice.from('documents').select('user_id').eq('id', docId).single();
    expect(data?.user_id).toBe(aliceId);
  });

  it("hides one user's documents from another", async () => {
    const mine = await alice.from('documents').select('id');
    const theirs = await bob.from('documents').select('id');
    expect(mine.data?.map((d) => d.id)).toContain(docId);
    expect(theirs.data).toEqual([]);
  });

  it('gives anonymous visitors no access at all', async () => {
    const { data, error } = await anon.from('documents').select('id');
    expect(data ?? []).toEqual([]);
    expect(error).not.toBeNull(); // privilege revoked, not just filtered
  });

  it("refuses to update or delete another user's document without error and without effect", async () => {
    const upd = await bob.from('documents').update({ title: 'hacked' }).eq('id', docId).select();
    const del = await bob.from('documents').delete().eq('id', docId).select();
    expect(upd.data).toEqual([]);
    expect(del.data).toEqual([]);
    const { data } = await alice.from('documents').select('title').eq('id', docId).single();
    expect(data?.title).toBe('Alice notes');
  });

  it('rejects inserting a row on behalf of someone else', async () => {
    const { error } = await bob
      .from('documents')
      .insert({ user_id: aliceId, title: 'forged', content: 'x' });
    expect(error?.code).toBe('42501'); // row-level security violation
  });

  it('runs the migrated version of match_chunks (no drift between database and repository)', async () => {
    const [row] = (await sql(
      "select prosrc like '%iterative_scan%' as iterative from pg_proc where proname = 'match_chunks'",
    )) as { iterative: boolean }[];
    expect(row.iterative).toBe(true);
  });

  it('indexes chunks atomically and retrieves them by similarity', async () => {
    const indexed = await indexAs(alice, docId, 'h1', chunks(3));
    expect(indexed.error).toBeNull();
    const doc = await alice.from('documents').select('indexing_status, content_hash').eq('id', docId).single();
    expect(doc.data).toMatchObject({ indexing_status: 'indexed', content_hash: 'h1' });

    const query = axis(1);
    const { data, error } = await alice.rpc('match_chunks', {
      query_embedding: JSON.stringify(query),
      match_count: 3,
    });
    expect(error).toBeNull();
    expect(data[0]).toMatchObject({ chunk_index: 1, document_title: 'Alice notes' });
    expect(data[0].similarity).toBeCloseTo(1, 5);
    expect(data[1].similarity).toBeCloseTo(0, 5);
  }, 30000);

  it('applies the minimum similarity and the result limit', async () => {
    const strict = await alice.rpc('match_chunks', {
      query_embedding: JSON.stringify(axis(2)),
      match_count: 3,
      min_similarity: 0.5,
    });
    expect(strict.data).toHaveLength(1);
    const limited = await alice.rpc('match_chunks', {
      query_embedding: JSON.stringify(axis(2)),
      match_count: 2,
    });
    expect(limited.data).toHaveLength(2);
  });

  it("never returns another user's chunks, even for a perfect match", async () => {
    const { data } = await bob.rpc('match_chunks', {
      query_embedding: JSON.stringify(axis(1)),
      match_count: 5,
    });
    expect(data).toEqual([]);
  });

  it("refuses to index into another user's document", async () => {
    const { error } = await bob.rpc('replace_document_chunks', {
      p_document_id: docId,
      p_embedding_model: 'evil',
      p_content_hash: 'x',
      p_content_digest: documentDigest('Alice notes', 'secret plans'),
      p_chunks: chunks(1),
    });
    expect(error?.code).toBe('P0002');
  });

  it('makes cross-user chunks impossible even for the service role (composite foreign key)', async () => {
    const { error } = await admin.from('document_chunks').insert({
      document_id: docId,
      user_id: bobId,
      chunk_index: 99,
      content: 'x',
      embedding: JSON.stringify(axis(5)),
      embedding_model: 'm',
    });
    expect(error?.code).toBe('23503'); // foreign key violation
  });

  it('stays complete when the vector index is full of dead entries (worst case)', async () => {
    // Re-indexing deletes and re-inserts chunks; the approximate index keeps the deleted
    // entries until VACUUM, and searches on a large table use that index. A plain query on
    // that index returned 2 of 3 rows here. NOTE: the previous version of match_chunks also
    // passed this synthetic scenario (its plan differs); the failure it had was seen as
    // flaky results in repeated live runs, so this guards completeness but does not by itself
    // prove the fix. Done inside ONE transaction (autovacuum cannot interfere, and
    // everything is rolled back), as the signed-in user, calling the real function.
    const user = '00000000-0000-4000-8000-0000000000aa';
    const doc = '00000000-0000-4000-8000-0000000000bb';
    const filler = `(select array_agg(case when i = (g % 1000) + 10 then 1 else 0 end)
                       from generate_series(1, 1536) i)::extensions.vector`;
    const axisVector = (n: number) => `'${JSON.stringify(axis(n))}'::extensions.vector`;
    const rows = await sql(`
      begin;
      insert into auth.users (id, aud, role, email)
        values ('${user}', 'authenticated', 'authenticated', 'churn@example.test');
      insert into public.documents (id, user_id, title, content) values ('${doc}', '${user}', 't', 'c');
      insert into public.document_chunks (document_id, user_id, chunk_index, content, embedding, embedding_model)
        select '${doc}', '${user}', g, 'filler', ${filler}, 'm' from generate_series(1, 200) g;
      delete from public.document_chunks;
      insert into public.document_chunks (document_id, user_id, chunk_index, content, embedding, embedding_model)
        values ('${doc}', '${user}', 0, 'a', ${axisVector(0)}, 'm'),
               ('${doc}', '${user}', 1, 'b', ${axisVector(1)}, 'm'),
               ('${doc}', '${user}', 2, 'c', ${axisVector(2)}, 'm');
      -- On a big table the planner searches through the vector index; make it do the same here
      -- (the DDL is rolled back with the transaction). Then search as the signed-in user.
      drop index public.document_chunks_user_idx;
      set local role authenticated;
      set local enable_seqscan = off;
      select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true);
      select count(*)::int as found from public.match_chunks(${axisVector(2)}, 3);
      rollback;`);
    expect(rows).toEqual([{ found: 3 }]);
  }, 60000);

  it('replaces chunks instead of piling them up', async () => {
    await indexAs(alice, docId, 'h2');
    const { count } = await alice
      .from('document_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', docId);
    expect(count).toBe(1);
  });

  it('moves updated_at only for user edits, not for indexing', async () => {
    const before = (await alice.from('documents').select('updated_at').eq('id', docId).single()).data!;
    await new Promise((r) => setTimeout(r, 1100));
    await indexAs(alice, docId, 'h3');
    const afterIndex = (await alice.from('documents').select('updated_at').eq('id', docId).single()).data!;
    expect(afterIndex.updated_at).toBe(before.updated_at);
    await alice.from('documents').update({ title: 'Alice notes v2' }).eq('id', docId);
    const afterEdit = (await alice.from('documents').select('updated_at').eq('id', docId).single()).data!;
    expect(afterEdit.updated_at).not.toBe(before.updated_at);
  }, 30000);

  it('keeps conversations private and messages append-only', async () => {
    const conv = await alice.from('conversations').insert({}).select().single();
    expect(conv.error).toBeNull();
    const exchange = await alice.rpc('append_exchange', {
      p_conversation_id: conv.data.id,
      p_user_content: 'hi',
      p_assistant_content: 'hello',
      p_sources: [],
    });
    expect(exchange.error).toBeNull();
    const msg = { data: exchange.data[0] as { id: string } };

    expect((await bob.from('conversations').select('id')).data).toEqual([]);
    expect((await bob.from('messages').select('id')).data).toEqual([]);
    const forged = await bob
      .from('messages')
      .insert({ conversation_id: conv.data.id, role: 'user', content: 'intruder' });
    expect(forged.error).not.toBeNull();
    const edited = await alice.from('messages').update({ content: 'changed' }).eq('id', msg.data.id).select();
    expect(edited.data).toEqual([]); // no update policy: history cannot be rewritten
  });

  it('stores a question and its answer together, in order, and names the conversation', async () => {
    const conv = (await alice.from('conversations').insert({}).select().single()).data!;
    const { data, error } = await alice.rpc('append_exchange', {
      p_conversation_id: conv.id,
      p_user_content: 'question?',
      p_assistant_content: 'answer [1]',
      p_sources: [{ number: 1 }],
      p_new_title: 'question?',
    });
    expect(error).toBeNull();
    expect(data.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(data[1].sources).toEqual([{ number: 1 }]);
    const stored = await alice.from('messages').select('role, seq').eq('conversation_id', conv.id).order('seq');
    expect(stored.data?.map((m) => m.role)).toEqual(['user', 'assistant']);
    const renamed = await alice.from('conversations').select('title').eq('id', conv.id).single();
    expect(renamed.data?.title).toBe('question?');
  });

  it("refuses to write an exchange into another user's conversation", async () => {
    const conv = (await alice.from('conversations').insert({}).select().single()).data!;
    const { error } = await bob.rpc('append_exchange', {
      p_conversation_id: conv.id,
      p_user_content: 'intruder',
      p_assistant_content: 'x',
      p_sources: [],
    });
    expect(error?.code).toBe('P0002');
    const { count } = await admin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conv.id);
    expect(count).toBe(0);
  });

  describe('writes that bypassed the API are closed', () => {
    it('does not let a user insert chunks (and so crowd out other users) directly', async () => {
      const { error } = await alice.from('document_chunks').insert({
        document_id: docId,
        chunk_index: 500,
        content: 'forged',
        embedding: JSON.stringify(axis(7)),
        embedding_model: 'm',
      });
      expect(error?.code).toBe('42501');
    });

    it('does not let a user delete or edit chunks directly', async () => {
      await indexAs(alice, docId, 'h-direct');
      const del = await alice.from('document_chunks').delete().eq('document_id', docId).select();
      expect(del.error?.code).toBe('42501');
      const upd = await alice.from('document_chunks').update({ content: 'x' }).eq('document_id', docId).select();
      expect(upd.error?.code).toBe('42501');
    });

    it('does not let a user write messages directly (forged answers, unbounded storage)', async () => {
      const conv = (await alice.from('conversations').insert({}).select().single()).data!;
      const { error } = await alice
        .from('messages')
        .insert({ conversation_id: conv.id, role: 'assistant', content: 'forged', sources: [] });
      expect(error?.code).toBe('42501');
    });

    it('lets a user edit title, text and tags but not the indexing bookkeeping', async () => {
      const ok = await alice.from('documents').update({ tags: ['kept'] }).eq('id', docId).select('tags').single();
      expect(ok.error).toBeNull();
      expect(ok.data?.tags).toEqual(['kept']);
      for (const forged of [{ indexing_status: 'indexed' }, { content_hash: 'forged' }, { indexed_at: new Date().toISOString() }, { user_id: bobId }]) {
        const { error } = await alice.from('documents').update(forged).eq('id', docId);
        expect(error?.code, JSON.stringify(forged)).toBe('42501');
      }
      const created = await alice.from('documents').insert({ title: 'fake', content: 'x', indexing_status: 'indexed' });
      expect(created.error?.code).toBe('42501');
    });

    it('limits tags in the database as well', async () => {
      const tooMany = Array.from({ length: 21 }, (_, i) => `t${i}`);
      expect((await alice.from('documents').update({ tags: tooMany }).eq('id', docId)).error?.code).toBe('23514');
      expect((await alice.from('documents').update({ tags: ['x'.repeat(41)] }).eq('id', docId)).error?.code).toBe('23514');
      expect((await alice.from('documents').update({ tags: [''] }).eq('id', docId)).error?.code).toBe('23514');
    });
  });

  describe('indexing results are tied to the version of the text', () => {
    it('refuses a result for text that has changed since (a stale embedding run)', async () => {
      await indexAs(alice, docId, 'h-current');
      const stale = await indexAs(alice, docId, 'h-stale', chunks(2), documentDigest('an older title', 'older text'));
      expect(stale.error?.code).toBe('P0003');
      const state = await alice.from('documents').select('content_hash').eq('id', docId).single();
      expect(state.data?.content_hash).toBe('h-current'); // nothing was overwritten
    });

    it('does not let a failure about older text mark the current text as failed', async () => {
      await indexAs(alice, docId, 'h-ok');
      const ignored = await alice.rpc('mark_indexing_failed', {
        p_document_id: docId,
        p_error: 'about an old version',
        p_content_digest: documentDigest('an older title', 'older text'),
      });
      expect(ignored.error).toBeNull();
      expect((await alice.from('documents').select('indexing_status').eq('id', docId).single()).data?.indexing_status).toBe('indexed');
    });

    it('records a failure about the current text, shortened, and a later success clears it', async () => {
      const doc = (await alice.from('documents').select('title, content').eq('id', docId).single()).data!;
      const marked = await alice.rpc('mark_indexing_failed', {
        p_document_id: docId,
        p_error: 'x'.repeat(1000),
        p_content_digest: documentDigest(doc.title, doc.content),
      });
      expect(marked.error).toBeNull();
      const failed = (await alice.from('documents').select('indexing_status, indexing_error').eq('id', docId).single()).data!;
      expect(failed.indexing_status).toBe('failed');
      expect(failed.indexing_error).toHaveLength(300);
      await indexAs(alice, docId, 'h-recovered');
      const healed = (await alice.from('documents').select('indexing_status, indexing_error').eq('id', docId).single()).data!;
      expect(healed).toEqual({ indexing_status: 'indexed', indexing_error: null });
    });

    it("lets nobody mark another user's document", async () => {
      const { error } = await bob.rpc('mark_indexing_failed', {
        p_document_id: docId,
        p_error: 'sabotage',
        p_content_digest: documentDigest('Alice notes', 'secret plans'),
      });
      expect(error?.code).toBe('P0002');
    });

    it('serialises overlapping runs: no unique violation, and the stored chunks are one run, not a mix', async () => {
      const results = await Promise.all([
        indexAs(alice, docId, 'run-a', chunks(4)),
        indexAs(alice, docId, 'run-b', chunks(2)),
        indexAs(alice, docId, 'run-c', chunks(3)),
      ]);
      for (const result of results) expect(result.error).toBeNull();
      const { count } = await alice.from('document_chunks').select('id', { count: 'exact', head: true }).eq('document_id', docId);
      expect([2, 3, 4]).toContain(count);
      const hash = (await alice.from('documents').select('content_hash').eq('id', docId).single()).data?.content_hash;
      expect({ 'run-a': 4, 'run-b': 2, 'run-c': 3 }[hash as string]).toBe(count); // hash and chunks belong together
    });

    it.each([
      ['more chunks than allowed', Array.from({ length: 501 }, (_, i) => ({ index: i, content: 'c', tokenCount: 1, embedding: axis(0) }))],
      ['something that is not a list', { not: 'a list' }],
    ])('rejects %s', async (_name, list) => {
      const { error } = await indexAs(alice, docId, 'bad', list as never);
      expect(error?.code).toBe('22023');
    }, 60000);
  });

  describe('exchanges are validated in the database', () => {
    const exchange = (conversation: string, over: Record<string, unknown> = {}) =>
      alice.rpc('append_exchange', {
        p_conversation_id: conversation,
        p_user_content: 'q',
        p_assistant_content: 'a',
        p_sources: [],
        ...over,
      });

    it.each([
      ['a question over 4000 characters', { p_user_content: 'q'.repeat(4001) }],
      ['an answer over 50000 characters', { p_assistant_content: 'a'.repeat(50001) }],
      ['sources that are not a list', { p_sources: { not: 'a list' } }],
    ])('rejects %s', async (_name, over) => {
      const conv = (await alice.from('conversations').insert({}).select().single()).data!;
      expect((await exchange(conv.id, over)).error?.code).toBe('22023');
      const { count } = await admin.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conv.id);
      expect(count).toBe(0);
    });

    it('rejects an oversized sources list through the size limit', async () => {
      const conv = (await alice.from('conversations').insert({}).select().single()).data!;
      const huge = Array.from({ length: 2000 }, (_, i) => ({ number: i, snippet: 'x'.repeat(100) }));
      expect((await exchange(conv.id, { p_sources: huge })).error?.code).toBe('23514');
    });

    it('truncates an over-long new title instead of failing', async () => {
      const conv = (await alice.from('conversations').insert({}).select().single()).data!;
      expect((await exchange(conv.id, { p_new_title: 't'.repeat(500) })).error).toBeNull();
      const title = (await alice.from('conversations').select('title').eq('id', conv.id).single()).data?.title;
      expect(title).toHaveLength(200);
    });
  });

  describe('per-user caps', () => {
    const outcome = (table: string, columns: string, values: string, userId: string) => `
      begin;
      insert into auth.users (id, aud, role, email) values ('${userId}', 'authenticated', 'authenticated', '${userId}@example.test');
      insert into public.${table} (user_id, ${columns}) select '${userId}', ${values} from generate_series(1, 200) g;
      create temp table outcome (code text) on commit drop;
      do $$ begin
        insert into public.${table} (user_id, ${columns}) select '${userId}', ${values} from generate_series(1, 1) g;
        insert into outcome values ('inserted');
      exception when sqlstate 'P0004' then
        insert into outcome values ('P0004');
      end $$;
      select code from outcome;
      rollback;`;

    it('refuses the 201st document with a recognisable error', async () => {
      const rows = await sql(outcome('documents', 'title, content', "'t' || g, 'c'", '00000000-0000-4000-8000-0000000000c1'));
      expect(rows).toEqual([{ code: 'P0004' }]);
    }, 60000);

    it('refuses the 201st conversation with a recognisable error', async () => {
      const rows = await sql(outcome('conversations', 'title', "'c' || g", '00000000-0000-4000-8000-0000000000c2'));
      expect(rows).toEqual([{ code: 'P0004' }]);
    }, 60000);
  });

  it('removes chunks together with their document', async () => {
    await alice.from('documents').delete().eq('id', docId);
    const { count } = await admin
      .from('document_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', docId);
    expect(count).toBe(0);
  });
});
