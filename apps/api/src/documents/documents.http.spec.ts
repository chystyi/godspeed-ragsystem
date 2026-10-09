import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '../../test/in-memory-documents.js';
import { EMBEDDING_MODEL, type EmbeddingModel } from '../ai/ai.types.js';
import { AiProviderError } from '../ai/errors.js';
import { TOKEN_VERIFIER, type TokenVerifier } from '../auth/auth.types.js';
import { configureApp } from '../http/configure-app.js';
import { DOCUMENTS_REPOSITORY_FACTORY } from './documents.repository.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { IndexingService } from './indexing.service.js';

class FakeEmbedder implements EmbeddingModel {
  model = 'fake/embed';
  dimensions = 4;
  calls = 0;
  failWith: Error | undefined;
  async embed(texts: string[]) {
    this.calls++;
    if (this.failWith) throw this.failWith;
    return { vectors: texts.map(() => [1, 0, 0, 0]), usage: { totalTokens: texts.length } };
  }
}

/** Tokens look like "token-alice"; anything else is rejected. */
const verifier: TokenVerifier = {
  async verify(token) {
    return token.startsWith('token-') ? { id: token.slice(6), token } : null;
  },
};

let app: INestApplication;
let db: InMemoryDatabase;
let embedder: FakeEmbedder;

beforeEach(async () => {
  db = new InMemoryDatabase();
  embedder = new FakeEmbedder();
  const moduleRef = await Test.createTestingModule({
    controllers: [DocumentsController],
    providers: [
      DocumentsService,
      IndexingService,
      { provide: DOCUMENTS_REPOSITORY_FACTORY, useValue: db.factory() },
      { provide: EMBEDDING_MODEL, useValue: embedder },
      { provide: TOKEN_VERIFIER, useValue: verifier },
    ],
  }).compile();
  app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureApp(app);
  await app.init();
});

afterEach(async () => {
  await app.close();
});

const as = (user: string) => ({ Authorization: `Bearer token-${user}` });
const server = () => request(app.getHttpServer());
const create = (user: string, body: object = { title: 'Guide', content: 'Some text.' }) =>
  server().post('/api/documents').set(as(user)).send(body);

describe('authentication', () => {
  it.each([
    ['no header', undefined],
    ['wrong scheme', 'Basic dXNlcjpwYXNz'],
    ['empty bearer', 'Bearer '],
    ['unknown token', 'Bearer garbage'],
  ])('rejects %s with 401 and a JSON error', async (_name, header) => {
    const req = server().get('/api/documents');
    if (header !== undefined) req.set('Authorization', header);
    const res = await req;
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ code: 'unauthorized', message: expect.any(String) });
  });

  it('protects every route', async () => {
    const id = '7d1f0b9e-6c1e-4a54-9c43-0d9a8f6c1111';
    for (const [method, path] of [
      ['post', '/api/documents'],
      ['get', `/api/documents/${id}`],
      ['patch', `/api/documents/${id}`],
      ['delete', `/api/documents/${id}`],
      ['post', `/api/documents/${id}/reindex`],
    ] as const) {
      expect((await server()[method](path)).status).toBe(401);
    }
  });
});

describe('creating documents', () => {
  it('stores, indexes and returns the document', async () => {
    const res = await create('alice', { title: '  Guide ', content: 'Some text.', tags: ['AI', ' ai ', 'rag'] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Guide',
      content: 'Some text.',
      tags: ['ai', 'rag'],
      indexingStatus: 'indexed',
      indexingError: null,
    });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body).not.toHaveProperty('contentHash');
    expect(db.chunks).toHaveLength(1);
  });

  it.each([
    ['missing title', { content: 'x' }],
    ['blank title', { title: '   ', content: 'x' }],
    ['blank content', { title: 't', content: '  \n ' }],
    ['title too long', { title: 'a'.repeat(201), content: 'x' }],
    ['content too long', { title: 't', content: 'a'.repeat(200001) }],
    ['tags not an array', { title: 't', content: 'x', tags: 'ai' }],
    ['too many tags', { title: 't', content: 'x', tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }],
    ['empty tag', { title: 't', content: 'x', tags: [''] }],
    ['wrong type', { title: 5, content: 'x' }],
    ['unknown field', { title: 't', content: 'x', userId: 'bob' }],
  ])('rejects %s with 422 and field details', async (_name, body) => {
    const res = await create('alice', body);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('validation_error');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(db.documents).toHaveLength(0);
  });

  it('does not echo submitted content in validation errors', async () => {
    const res = await create('alice', { title: 'a'.repeat(300), content: 'private text' });
    expect(JSON.stringify(res.body)).not.toContain('private text');
  });

  it('rejects an oversized body with 413 in the standard format', async () => {
    const res = await create('alice', { title: 't', content: 'a'.repeat(3 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('payload_too_large');
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await server()
      .post('/api/documents')
      .set(as('alice'))
      .set('Content-Type', 'application/json')
      .send('{"title": ');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('bad_request');
  });

  it('keeps the document when the AI provider fails, and allows a retry', async () => {
    embedder.failWith = new AiProviderError('unavailable', 'embeddings request failed (HTTP 503)', 503);
    const res = await create('alice');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ indexingStatus: 'failed' });
    expect(res.body.indexingError).toContain('HTTP 503');

    embedder.failWith = undefined;
    const retry = await server().post(`/api/documents/${res.body.id}/reindex`).set(as('alice'));
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ indexingStatus: 'indexed', indexingError: null });
  });
});

describe('reading documents', () => {
  it('lists only own documents, newest first, without full text', async () => {
    await create('alice', { title: 'First', content: 'a'.repeat(500) });
    await create('alice', { title: 'Second', content: 'b' });
    await create('bob', { title: 'Bob private', content: 'c' });
    const res = await server().get('/api/documents').set(as('alice'));
    expect(res.status).toBe(200);
    expect(res.body.map((d: { title: string }) => d.title)).toEqual(['Second', 'First']);
    expect(res.body[1].preview).toHaveLength(200);
    expect(res.body[0]).not.toHaveProperty('content');
  });

  it('returns one document with its text', async () => {
    const { body } = await create('alice');
    const res = await server().get(`/api/documents/${body.id}`).set(as('alice'));
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('Some text.');
  });

  it('answers 404 for foreign, unknown and malformed ids alike (no existence leak)', async () => {
    const { body } = await create('alice');
    for (const id of [body.id, '7d1f0b9e-6c1e-4a54-9c43-0d9a8f6c1111', 'not-a-uuid', '1; drop table documents']) {
      const res = await server().get(`/api/documents/${encodeURIComponent(id)}`).set(as('bob'));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('document_not_found');
    }
  });
});

describe('updating documents', () => {
  it('re-indexes when the text changes', async () => {
    const { body } = await create('alice');
    const res = await server().patch(`/api/documents/${body.id}`).set(as('alice')).send({ content: 'New text.' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ content: 'New text.', indexingStatus: 'indexed' });
    expect(db.chunks.map((c) => c.content)).toEqual(['New text.']);
    expect(embedder.calls).toBe(2);
  });

  it('does not call the AI provider when only tags change', async () => {
    const { body } = await create('alice');
    const res = await server().patch(`/api/documents/${body.id}`).set(as('alice')).send({ tags: ['x'] });
    expect(res.body.tags).toEqual(['x']);
    expect(embedder.calls).toBe(1);
  });

  it('rejects an empty update and unknown fields', async () => {
    const { body } = await create('alice');
    for (const payload of [{}, { id: 'other' }, { userId: 'bob' }]) {
      const res = await server().patch(`/api/documents/${body.id}`).set(as('alice')).send(payload);
      expect(res.status).toBe(422);
    }
  });

  it("cannot change another user's document", async () => {
    const { body } = await create('alice');
    const res = await server().patch(`/api/documents/${body.id}`).set(as('bob')).send({ title: 'mine now' });
    expect(res.status).toBe(404);
    expect((await server().get(`/api/documents/${body.id}`).set(as('alice'))).body.title).toBe('Guide');
  });
});

describe('deleting documents', () => {
  it('removes the document and its chunks', async () => {
    const { body } = await create('alice');
    const res = await server().delete(`/api/documents/${body.id}`).set(as('alice'));
    expect(res.status).toBe(204);
    expect(db.chunks).toHaveLength(0);
    expect((await server().get(`/api/documents/${body.id}`).set(as('alice'))).status).toBe(404);
  });

  it("cannot delete another user's document", async () => {
    const { body } = await create('alice');
    expect((await server().delete(`/api/documents/${body.id}`).set(as('bob'))).status).toBe(404);
    expect(db.documents).toHaveLength(1);
  });
});

describe('error format', () => {
  it('answers unknown routes in the standard format', async () => {
    const res = await server().get('/api/nothing-here').set(as('alice'));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: 'not_found', message: expect.any(String) });
  });

  it('hides internal details of unexpected failures', async () => {
    const broken = {
      forUser: () => {
        throw new Error('database password is hunter2');
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [
        DocumentsService,
        IndexingService,
        { provide: DOCUMENTS_REPOSITORY_FACTORY, useValue: broken },
        { provide: EMBEDDING_MODEL, useValue: embedder },
        { provide: TOKEN_VERIFIER, useValue: verifier },
      ],
    }).compile();
    const other = moduleRef.createNestApplication({ bodyParser: false, logger: false });
    configureApp(other);
    await other.init();
    const res = await request(other.getHttpServer()).get('/api/documents').set(as('alice'));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ code: 'internal_error', message: 'internal server error' });
    expect(res.text).not.toContain('hunter2');
    await other.close();
  });
});
