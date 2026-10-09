import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LiveUsers, type LiveUser } from '../../test/live-users.js';
import { AppModule } from '../app.module.js';
import { loadAiConfig } from '../config/ai-config.js';
import { loadRootEnv } from '../config/load-env.js';
import { configureApp } from '../http/configure-app.js';
import { createEmbeddingModel } from '../ai/openai-compatible.js';

// Opt-in end to end test: real Supabase, real OpenRouter, real NestJS application.
//   RUN_LIVE_E2E=1 npm run test -w @kb/api -- documents.live
describe.skipIf(!process.env.RUN_LIVE_E2E)('documents end to end (live)', () => {
  loadRootEnv();
  const users = new LiveUsers(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  let app: INestApplication;
  let alice: LiveUser;
  let bob: LiveUser;
  const ids: Record<string, string> = {};
  const auth = (user: LiveUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  const http = () => request(app.getHttpServer());

  const DOCS = {
    rsi: {
      title: 'Relative Strength Index',
      content:
        'The RSI is a momentum oscillator between 0 and 100. Values above 70 suggest an asset is overbought, ' +
        'values below 30 suggest it is oversold. Wilder smoothing averages gains and losses over 14 periods.',
    },
    pasta: {
      title: 'Carbonara recipe',
      content:
        'Cook spaghetti in salted water. Fry guanciale until crisp. Whisk egg yolks with pecorino and black ' +
        'pepper, then toss everything off the heat so the eggs turn into a silky sauce instead of scrambling.',
    },
    router: {
      title: 'Router setup guide',
      content:
        'Open the admin page of the router and set the DHCP lease time to 24 hours. Disable WPS, because it ' +
        'is a known security weakness, and choose WPA3 for the wireless network password.',
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
    configureApp(app);
    await app.init();
    alice = await users.signUp('alice');
    bob = await users.signUp('bob');
  }, 60000);

  afterAll(async () => {
    await users.cleanup();
    await app?.close();
  }, 60000);

  it('rejects requests without a valid token', async () => {
    expect((await http().get('/api/documents')).status).toBe(401);
    expect((await http().get('/api/documents').set('Authorization', 'Bearer not.a.jwt')).status).toBe(401);
  });

  it('creates and indexes documents with real embeddings', async () => {
    for (const [key, doc] of Object.entries(DOCS)) {
      const res = await http().post('/api/documents').set(auth(alice)).send({ ...doc, tags: [key] });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ indexingStatus: 'indexed', indexingError: null });
      ids[key] = res.body.id;
    }
  }, 60000);

  it('finds the right document by meaning, not by shared words', async () => {
    const embedder = createEmbeddingModel(loadAiConfig(process.env).embeddings);
    const ask = async (question: string) => {
      const { vectors } = await embedder.embed([question]);
      const { data, error } = await alice.client.rpc('match_chunks', {
        query_embedding: JSON.stringify(vectors[0]),
        match_count: 3,
      });
      expect(error).toBeNull();
      return data as { document_id: string; similarity: number }[];
    };
    // None of these questions shares a content word with its answer.
    expect((await ask('How do I cook a creamy Roman pasta with eggs?'))[0].document_id).toBe(ids.pasta);
    expect((await ask('Is this stock overheated and due for a pullback?'))[0].document_id).toBe(ids.rsi);
    expect((await ask('How do I make my home wifi safer?'))[0].document_id).toBe(ids.router);
  }, 60000);

  it("keeps the second user's view empty and cannot touch the first user's documents", async () => {
    expect((await http().get('/api/documents').set(auth(bob))).body).toEqual([]);
    expect((await http().get(`/api/documents/${ids.rsi}`).set(auth(bob))).status).toBe(404);
    expect((await http().delete(`/api/documents/${ids.rsi}`).set(auth(bob))).status).toBe(404);
    expect((await http().get(`/api/documents/${ids.rsi}`).set(auth(alice))).status).toBe(200);
  });

  it('lists documents without their text', async () => {
    const res = await http().get('/api/documents').set(auth(alice));
    expect(res.body).toHaveLength(3);
    expect(res.body[0]).not.toHaveProperty('content');
    expect(res.body[0].preview.length).toBeGreaterThan(0);
  });

  it('re-indexes on edit and skips the provider when only tags change', async () => {
    const before = (await http().get(`/api/documents/${ids.pasta}`).set(auth(alice))).body;
    const tagOnly = await http().patch(`/api/documents/${ids.pasta}`).set(auth(alice)).send({ tags: ['food'] });
    expect(tagOnly.body.indexedAt).toBe(before.indexedAt); // no new indexing run
    const edited = await http()
      .patch(`/api/documents/${ids.pasta}`)
      .set(auth(alice))
      .send({ content: 'Cacio e pepe needs only pecorino, black pepper and a splash of pasta water.' });
    expect(edited.body.indexingStatus).toBe('indexed');
    expect(edited.body.indexedAt).not.toBe(before.indexedAt);
  }, 60000);

  it('indexes a long document into several chunks', async () => {
    const long = Array.from({ length: 30 }, (_, i) => `Section ${i}. ${'The quick brown fox jumps. '.repeat(20)}`).join('\n\n');
    const res = await http().post('/api/documents').set(auth(alice)).send({ title: 'Long text', content: long });
    expect(res.body.indexingStatus).toBe('indexed');
    const { count } = await alice.client
      .from('document_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', res.body.id);
    expect(count).toBeGreaterThan(10);
    await http().delete(`/api/documents/${res.body.id}`).set(auth(alice));
  }, 90000);

  it('deletes a document together with its chunks', async () => {
    expect((await http().delete(`/api/documents/${ids.router}`).set(auth(alice))).status).toBe(204);
    const { count } = await alice.client
      .from('document_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', ids.router);
    expect(count).toBe(0);
  });
});
