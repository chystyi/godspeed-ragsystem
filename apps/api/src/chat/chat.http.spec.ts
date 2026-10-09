import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { request as nodeRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ChatStreamEvent } from '@kb/shared';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryChatDatabase } from '../../test/in-memory-chat.js';
import {
  CHAT_MODEL,
  type ChatCompletion,
  type ChatModel,
  EMBEDDING_MODEL,
  type EmbeddingModel,
} from '../ai/ai.types.js';
import { AiProviderError } from '../ai/errors.js';
import { TOKEN_VERIFIER, type TokenVerifier } from '../auth/auth.types.js';
import { configureApp } from '../http/configure-app.js';
import { CHAT_CONFIG, type ChatConfig } from './chat.config.js';
import { ChatController } from './chat.controller.js';
import { CHAT_REPOSITORY_FACTORY } from './chat.repository.js';
import { ChatService } from './chat.service.js';
import { RATE_LIMITER, RateLimitGuard, SlidingWindowLimiter } from './rate-limiter.js';

class FakeChat implements ChatModel {
  reply: string | Error = 'The answer [1].';
  /** Parts of a streamed answer; an Error is thrown at that point. Defaults to `reply`. */
  parts: (string | Error)[] | undefined;
  partDelayMs = 0;
  /** True once the streamed answer was finished or abandoned (the provider stream was closed). */
  streamClosed = false;
  async complete(): Promise<ChatCompletion> {
    if (this.reply instanceof Error) throw this.reply;
    return { content: this.reply, model: 'fake' };
  }

  async *stream(): AsyncGenerator<string> {
    this.streamClosed = false;
    try {
      const parts = this.parts ?? [this.reply];
      for (const part of parts) {
        if (this.partDelayMs) await new Promise((r) => setTimeout(r, this.partDelayMs));
        if (part instanceof Error) throw part;
        yield part;
      }
    } finally {
      this.streamClosed = true;
    }
  }
}

const embedder: EmbeddingModel = {
  model: 'fake/embed',
  dimensions: 3,
  async embed(texts) {
    return { vectors: texts.map(() => [0, 0, 1]), usage: { totalTokens: 1 } };
  },
};

const verifier: TokenVerifier = {
  async verify(token) {
    return token.startsWith('token-') ? { id: token.slice(6), token: token.slice(6) } : null;
  },
};

let app: INestApplication;
let db: InMemoryChatDatabase;
let chat: FakeChat;

async function build(rateLimit = 20): Promise<INestApplication> {
  const config: ChatConfig = {
    topK: 5,
    minSimilarity: 0.25,
    historyMessages: 10,
    rewriteQueries: false,
    rateLimitPerMinute: rateLimit,
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [ChatController],
    providers: [
      ChatService,
      RateLimitGuard,
      { provide: CHAT_REPOSITORY_FACTORY, useValue: db.factory() },
      { provide: CHAT_MODEL, useValue: chat },
      { provide: EMBEDDING_MODEL, useValue: embedder },
      { provide: CHAT_CONFIG, useValue: config },
      { provide: RATE_LIMITER, useValue: new SlidingWindowLimiter(rateLimit, 60_000) },
      { provide: TOKEN_VERIFIER, useValue: verifier },
    ],
  }).compile();
  const instance = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureApp(instance);
  await instance.init();
  return instance;
}

beforeAll(() => {
  Logger.overrideLogger(false);
});
beforeEach(async () => {
  db = new InMemoryChatDatabase();
  chat = new FakeChat();
  db.corpus = [
    { chunkId: 'c1', documentId: 'd1', documentTitle: 'Router guide', chunkIndex: 0, content: 'Disable WPS.', similarity: 0.7 },
  ];
  app = await build();
});
afterEach(async () => {
  await app.close();
});

const as = (user: string) => ({ Authorization: `Bearer token-${user}` });
const http = () => request(app.getHttpServer());
const newConversation = async (user = 'alice', body: object = {}) =>
  (await http().post('/api/conversations').set(as(user)).send(body)).body as { id: string };
const send = (id: string, user: string, content: unknown) =>
  http().post(`/api/conversations/${id}/messages`).set(as(user)).send({ content });

describe('authentication', () => {
  it('protects every route', async () => {
    const id = '7d1f0b9e-6c1e-4a54-9c43-0d9a8f6c1111';
    for (const [method, path] of [
      ['post', '/api/conversations'],
      ['get', '/api/conversations'],
      ['get', `/api/conversations/${id}`],
      ['delete', `/api/conversations/${id}`],
      ['post', `/api/conversations/${id}/messages`],
    ] as const) {
      const res = await http()[method](path);
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.body.code).toBe('unauthorized');
    }
  });
});

describe('conversations', () => {
  it('creates a conversation with a default or a chosen title', async () => {
    const plain = await http().post('/api/conversations').set(as('alice')).send({});
    expect(plain.status).toBe(201);
    expect(plain.body).toMatchObject({ title: 'New conversation' });
    const named = await http().post('/api/conversations').set(as('alice')).send({ title: '  Taxes ' });
    expect(named.body.title).toBe('Taxes');
  });

  it.each([{ title: '' }, { title: 'a'.repeat(201) }, { title: 5 }, { userId: 'bob' }])(
    'rejects %j with 422',
    async (body) => {
      expect((await http().post('/api/conversations').set(as('alice')).send(body)).status).toBe(422);
    },
  );

  it('lists only own conversations', async () => {
    await newConversation('alice');
    await newConversation('bob');
    const res = await http().get('/api/conversations').set(as('alice'));
    expect(res.body).toHaveLength(1);
  });

  it('shows messages in order and deletes with them', async () => {
    const { id } = await newConversation();
    await send(id, 'alice', 'first');
    await send(id, 'alice', 'second');
    const res = await http().get(`/api/conversations/${id}`).set(as('alice'));
    expect(res.body.messages.map((m: { role: string; content: string }) => [m.role, m.content])).toEqual([
      ['user', 'first'],
      ['assistant', 'The answer [1].'],
      ['user', 'second'],
      ['assistant', 'The answer [1].'],
    ]);
    expect((await http().delete(`/api/conversations/${id}`).set(as('alice'))).status).toBe(204);
    expect((await http().get(`/api/conversations/${id}`).set(as('alice'))).status).toBe(404);
  });

  it('answers 404 for foreign, unknown and malformed ids alike', async () => {
    const { id } = await newConversation('alice');
    for (const target of [id, '7d1f0b9e-6c1e-4a54-9c43-0d9a8f6c1111', 'nope', '1;drop']) {
      for (const res of [
        await http().get(`/api/conversations/${target}`).set(as('bob')),
        await send(target, 'bob', 'hi'),
        await http().delete(`/api/conversations/${target}`).set(as('bob')),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('conversation_not_found');
      }
    }
    expect(db.messages).toHaveLength(0);
  });
});

describe('asking questions', () => {
  it('returns the stored question and the answer with its sources', async () => {
    const { id } = await newConversation();
    const res = await send(id, 'alice', 'How do I secure the router?');
    expect(res.status).toBe(201);
    expect(res.body.userMessage).toMatchObject({ role: 'user', content: 'How do I secure the router?', sources: null });
    expect(res.body.assistantMessage).toMatchObject({ role: 'assistant', content: 'The answer [1].' });
    expect(res.body.assistantMessage.sources).toEqual([
      expect.objectContaining({ number: 1, documentTitle: 'Router guide', cited: true, snippet: 'Disable WPS.' }),
    ]);
  });

  it('stores text exactly as sent, including markup', async () => {
    const { id } = await newConversation();
    const text = '<script>alert(1)</script> & "quotes" ${x}';
    const res = await send(id, 'alice', text);
    expect(res.body.userMessage.content).toBe(text);
  });

  it.each([
    ['empty', ''],
    ['blank', '   \n '],
    ['too long', 'a'.repeat(4001)],
    ['not a string', 42],
    ['missing', undefined],
  ])('rejects a %s message with 422 and saves nothing', async (_name, content) => {
    const { id } = await newConversation();
    const res = await send(id, 'alice', content);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('validation_error');
    expect(db.messages).toHaveLength(0);
  });

  it('says so when the documents have nothing related', async () => {
    db.corpus = [];
    const { id } = await newConversation();
    const res = await send(id, 'alice', 'Capital of France?');
    expect(res.status).toBe(201);
    expect(res.body.assistantMessage.content).toMatch(/couldn't find anything/);
    expect(res.body.assistantMessage.sources).toEqual([]);
  });
});

describe('AI provider failures', () => {
  it.each([
    ['unavailable', 503, 'ai_unavailable'],
    ['rate_limited', 429, 'ai_rate_limited'],
    ['authentication', 502, 'ai_error'],
    ['invalid_response', 502, 'ai_error'],
  ] as const)('maps a "%s" provider error to %i %s without leaking details', async (kind, status, code) => {
    chat.reply = new AiProviderError(kind, 'internal detail sk-secret-key', 500);
    const { id } = await newConversation();
    const res = await send(id, 'alice', 'q');
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
    expect(res.text).not.toContain('sk-secret-key');
    expect(db.messages).toHaveLength(0); // nothing saved: the user can ask again
  });
});

describe('rate limit', () => {
  it('refuses a flood of questions per user, tells when to retry, and spares others', async () => {
    await app.close();
    app = await build(3);
    const { id } = await newConversation('alice');
    const other = await newConversation('bob');
    for (let i = 0; i < 3; i++) expect((await send(id, 'alice', `q${i}`)).status).toBe(201);
    const refused = await send(id, 'alice', 'one too many');
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe('too_many_requests');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect((await send(other.id, 'bob', 'still fine')).status).toBe(201);
    expect(db.messages.filter((m) => m.content === 'one too many')).toHaveLength(0);
  });

  it('does not limit reading or creating conversations', async () => {
    await app.close();
    app = await build(1);
    for (let i = 0; i < 5; i++) {
      expect((await http().get('/api/conversations').set(as('alice'))).status).toBe(200);
    }
  });
});


describe('streaming answers (server-sent events)', () => {
  /** Reads the whole body as text and splits it into the events of the stream. */
  const streamOf = (id: string, user: string, content: unknown) =>
    http()
      .post(`/api/conversations/${id}/messages/stream`)
      .set(as(user))
      .send({ content })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', (part: Buffer) => (data += part.toString()));
        res.on('end', () => callback(null, data));
      });
  const eventsOf = (res: { body: unknown }): ChatStreamEvent[] =>
    String(res.body)
      .split('\n\n')
      .filter((block) => block.trim() !== '')
      .map((block) => {
        const lines = block.split('\n');
        const name = lines.find((l) => l.startsWith('event: '))!.slice(7);
        const event = JSON.parse(lines.find((l) => l.startsWith('data: '))!.slice(6)) as ChatStreamEvent;
        expect(event.type).toBe(name); // the SSE event name and the payload agree
        return event;
      });

  it('streams start, text parts and done, with SSE headers', async () => {
    chat.parts = ['The ', 'answer ', '[1].'];
    const { id } = await newConversation();
    const res = await streamOf(id, 'alice', 'How do I secure the router?');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(res.headers['cache-control']).toMatch(/no-cache/);
    expect(res.headers['x-accel-buffering']).toBe('no');

    const events = eventsOf(res);
    expect(events.map((e) => e.type)).toEqual(['start', 'delta', 'delta', 'delta', 'done']);
    const done = events.at(-1) as Extract<ChatStreamEvent, { type: 'done' }>;
    expect(done.assistantMessage.content).toBe('The answer [1].');
    expect(done.assistantMessage.sources?.[0]).toMatchObject({ documentTitle: 'Router guide', cited: true });

    const stored = await http().get(`/api/conversations/${id}`).set(as('alice'));
    expect(stored.body.messages.map((m: { content: string }) => m.content)).toEqual([
      'How do I secure the router?',
      'The answer [1].',
    ]);
  });

  it.each([
    ['without a token', () => http().post('/api/conversations/x/messages/stream').send({ content: 'q' }), 401, 'unauthorized'],
  ])('answers %s with a normal JSON error', async (_n, call, status, code) => {
    const res = await call();
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
  });

  it('reports problems found before the stream starts as normal JSON errors', async () => {
    const { id } = await newConversation('alice');
    const foreign = await streamOf(id, 'bob', 'hi');
    expect(foreign.status).toBe(404);
    expect(JSON.parse(String(foreign.body)).code).toBe('conversation_not_found');
    const blank = await streamOf(id, 'alice', '   ');
    expect(blank.status).toBe(422);
    const malformed = await streamOf('nope', 'alice', 'hi');
    expect(malformed.status).toBe(404);
    expect(db.messages).toHaveLength(0);
  });

  it('turns a provider that rejects the request into a normal 429/503, not a broken stream', async () => {
    const { id } = await newConversation();
    chat.parts = [new AiProviderError('rate_limited', 'internal sk-secret detail', 429)];
    const limited = await streamOf(id, 'alice', 'q');
    expect(limited.status).toBe(429);
    expect(JSON.parse(String(limited.body)).code).toBe('ai_rate_limited');
    expect(String(limited.body)).not.toContain('sk-secret');
    chat.parts = [new AiProviderError('unavailable', 'down', 503)];
    expect((await streamOf(id, 'alice', 'q')).status).toBe(503);
    expect(db.messages).toHaveLength(0);
  });

  it('ends with an error event, saves nothing, and hides details when the answer breaks off', async () => {
    const { id } = await newConversation();
    chat.parts = ['half ', new AiProviderError('unavailable', 'connection lost sk-secret', 503)];
    const res = await streamOf(id, 'alice', 'q');
    expect(res.status).toBe(200); // the stream had already started
    const events = eventsOf(res);
    expect(events.map((e) => e.type)).toEqual(['start', 'delta', 'error']);
    expect(events.at(-1)).toEqual({ type: 'error', code: 'ai_unavailable', message: expect.any(String) });
    expect(String(res.body)).not.toContain('sk-secret');
    expect(db.messages).toHaveLength(0);
  });

  it('stops the provider stream and saves nothing when the client disconnects', async () => {
    const server = app.getHttpServer().listen(0);
    const { port } = server.address() as AddressInfo;
    const { id } = await newConversation();
    chat.parts = Array.from({ length: 40 }, (_, i) => `part ${i} `);
    chat.partDelayMs = 25;

    await new Promise<void>((resolve, reject) => {
      const req = nodeRequest(
        {
          port,
          method: 'POST',
          path: `/api/conversations/${id}/messages/stream`,
          headers: { ...as('alice'), 'Content-Type': 'application/json' },
        },
        (res) => {
          res.once('data', () => {
            req.destroy(); // the user closed the page after the first bytes
            resolve();
          });
        },
      );
      req.on('error', () => undefined);
      req.on('error', reject);
      req.end(JSON.stringify({ content: 'q' }));
    });

    await new Promise((r) => setTimeout(r, 400));
    expect(chat.streamClosed).toBe(true);
    expect(db.messages).toHaveLength(0);
    server.close();
  });

  it('counts streamed questions against the same limit as plain ones', async () => {
    await app.close();
    app = await build(2);
    const { id } = await newConversation();
    expect((await send(id, 'alice', 'one')).status).toBe(201);
    expect((await streamOf(id, 'alice', 'two')).status).toBe(200);
    const refused = await streamOf(id, 'alice', 'three');
    expect(refused.status).toBe(429);
    expect(JSON.parse(String(refused.body)).code).toBe('too_many_requests');
  });
});
