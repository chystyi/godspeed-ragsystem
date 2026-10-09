import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LiveUsers } from '../../test/live-users.js';
import { loadRootEnv } from '../config/load-env.js';

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

  it('indexes chunks atomically and retrieves them by similarity', async () => {
    const indexed = await alice.rpc('replace_document_chunks', {
      p_document_id: docId,
      p_embedding_model: 'test/model',
      p_content_hash: 'h1',
      p_chunks: chunks(3),
    });
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
      -- On a big table the planner searches through the vector index; make it do the same here
      -- (the DDL is rolled back with the transaction).
      drop index public.document_chunks_user_idx;
      set local role authenticated;
      set local enable_seqscan = off;
      select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true);
      insert into public.documents (id, title, content) values ('${doc}', 't', 'c');
      insert into public.document_chunks (document_id, chunk_index, content, embedding, embedding_model)
        select '${doc}', g, 'filler', ${filler}, 'm' from generate_series(1, 200) g;
      delete from public.document_chunks;
      insert into public.document_chunks (document_id, chunk_index, content, embedding, embedding_model)
        values ('${doc}', 0, 'a', ${axisVector(0)}, 'm'),
               ('${doc}', 1, 'b', ${axisVector(1)}, 'm'),
               ('${doc}', 2, 'c', ${axisVector(2)}, 'm');
      select count(*)::int as found from public.match_chunks(${axisVector(2)}, 3);
      rollback;`);
    expect(rows).toEqual([{ found: 3 }]);
  }, 60000);

  it('replaces chunks instead of piling them up', async () => {
    await alice.rpc('replace_document_chunks', {
      p_document_id: docId,
      p_embedding_model: 'test/model',
      p_content_hash: 'h2',
      p_chunks: chunks(1),
    });
    const { count } = await alice
      .from('document_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', docId);
    expect(count).toBe(1);
  });

  it('moves updated_at only for user edits, not for indexing', async () => {
    const before = (await alice.from('documents').select('updated_at').eq('id', docId).single()).data!;
    await new Promise((r) => setTimeout(r, 1100));
    await alice.rpc('replace_document_chunks', {
      p_document_id: docId,
      p_embedding_model: 'test/model',
      p_content_hash: 'h3',
      p_chunks: chunks(1),
    });
    const afterIndex = (await alice.from('documents').select('updated_at').eq('id', docId).single()).data!;
    expect(afterIndex.updated_at).toBe(before.updated_at);
    await alice.from('documents').update({ title: 'Alice notes v2' }).eq('id', docId);
    const afterEdit = (await alice.from('documents').select('updated_at').eq('id', docId).single()).data!;
    expect(afterEdit.updated_at).not.toBe(before.updated_at);
  }, 30000);

  it('keeps conversations private and messages append-only', async () => {
    const conv = await alice.from('conversations').insert({}).select().single();
    expect(conv.error).toBeNull();
    const msg = await alice
      .from('messages')
      .insert({ conversation_id: conv.data.id, role: 'user', content: 'hi' })
      .select()
      .single();
    expect(msg.error).toBeNull();

    expect((await bob.from('conversations').select('id')).data).toEqual([]);
    expect((await bob.from('messages').select('id')).data).toEqual([]);
    const forged = await bob
      .from('messages')
      .insert({ conversation_id: conv.data.id, role: 'user', content: 'intruder' });
    expect(forged.error).not.toBeNull();
    const edited = await alice.from('messages').update({ content: 'changed' }).eq('id', msg.data.id).select();
    expect(edited.data).toEqual([]); // no update policy: history cannot be rewritten
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
