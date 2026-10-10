import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FakeOpenAiServer,
  chatReply,
  embeddingReply,
  errorReply,
  streamReply,
} from '../../test/fake-openai-server.js';
import { AiProviderError } from './errors.js';
import { createChatModel, createEmbeddingModel } from './openai-compatible.js';

const SECRET = 'sk-test-secret-123';

let server: FakeOpenAiServer;
beforeEach(async () => {
  server = new FakeOpenAiServer();
  await server.start();
});
afterEach(async () => {
  await server.stop();
});

const chatConfig = (over: Partial<Parameters<typeof createChatModel>[0]> = {}) => ({
  baseURL: server.baseURL,
  apiKey: SECRET,
  model: 'test/chat-model',
  timeoutMs: 5000,
  maxRetries: 0,
  ...over,
});

const embeddingConfig = (over: Partial<Parameters<typeof createEmbeddingModel>[0]> = {}) => ({
  baseURL: server.baseURL,
  apiKey: SECRET,
  model: 'test/embed-model',
  dimensions: 3,
  sendDimensions: true,
  timeoutMs: 5000,
  maxRetries: 0,
  ...over,
});

describe('chat model', () => {
  it('sends model, messages and bearer key, and returns content with token usage', async () => {
    server.setHandler(() => chatReply('Hello there', 'test/chat-model'));
    const result = await createChatModel(chatConfig()).complete(
      [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
      { temperature: 0.2, maxTokens: 50 },
    );
    expect(result).toEqual({
      content: 'Hello there',
      model: 'test/chat-model',
      usage: { promptTokens: 11, completionTokens: 5, totalTokens: 16 },
    });
    const [request] = server.requests;
    expect(request.path).toBe('/v1/chat/completions');
    expect(request.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(request.body).toMatchObject({
      model: 'test/chat-model',
      temperature: 0.2,
      max_tokens: 50,
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
    });
  });

  it('switches providers by configuration only (base URL, key, model)', async () => {
    const other = new FakeOpenAiServer();
    await other.start();
    try {
      server.setHandler(() => chatReply('from A'));
      other.setHandler(() => chatReply('from B'));
      const a = createChatModel(chatConfig({ model: 'a/model' }));
      const b = createChatModel(
        chatConfig({ baseURL: other.baseURL, apiKey: 'key-b', model: 'b/model' }),
      );
      expect((await a.complete([{ role: 'user', content: 'x' }])).content).toBe('from A');
      expect((await b.complete([{ role: 'user', content: 'x' }])).content).toBe('from B');
      expect(server.requests[0].body.model).toBe('a/model');
      expect(other.requests[0].body.model).toBe('b/model');
      expect(other.requests[0].headers.authorization).toBe('Bearer key-b');
    } finally {
      await other.stop();
    }
  });

  it.each([
    [401, 'authentication'],
    [403, 'authentication'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [400, 'bad_request'],
    [404, 'bad_request'],
  ] as const)('maps HTTP %i to the "%s" error kind', async (status, kind) => {
    server.setHandler(() => errorReply(status, 'nope'));
    const error = await createChatModel(chatConfig())
      .complete([{ role: 'user', content: 'x' }])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).kind).toBe(kind);
    expect((error as AiProviderError).status).toBe(status);
  });

  it('retries a transient failure and then succeeds', async () => {
    let calls = 0;
    server.setHandler(() => (++calls === 1 ? errorReply(503, 'busy') : chatReply('ok')));
    const result = await createChatModel(chatConfig({ maxRetries: 2 })).complete([
      { role: 'user', content: 'x' },
    ]);
    expect(result.content).toBe('ok');
    expect(server.requests).toHaveLength(2);
  });

  it('does not retry authentication errors', async () => {
    server.setHandler(() => errorReply(401, 'bad key'));
    await createChatModel(chatConfig({ maxRetries: 3 }))
      .complete([{ role: 'user', content: 'x' }])
      .catch(() => undefined);
    expect(server.requests).toHaveLength(1);
  });

  it('reports an unreachable provider as unavailable', async () => {
    const dead = chatConfig({ baseURL: 'http://127.0.0.1:1/v1' });
    const error = await createChatModel(dead)
      .complete([{ role: 'user', content: 'x' }])
      .catch((e: unknown) => e);
    expect((error as AiProviderError).kind).toBe('unavailable');
  });

  it('rejects a response without content instead of returning an empty answer', async () => {
    server.setHandler(() => chatReply(null));
    const error = await createChatModel(chatConfig())
      .complete([{ role: 'user', content: 'x' }])
      .catch((e: unknown) => e);
    expect((error as AiProviderError).kind).toBe('invalid_response');
  });

  it('never leaks the API key into error messages', async () => {
    server.setHandler(() => errorReply(401, 'invalid key'));
    const error = (await createChatModel(chatConfig())
      .complete([{ role: 'user', content: 'x' }])
      .catch((e: unknown) => e)) as AiProviderError;
    expect(error.message).not.toContain(SECRET);
    expect(JSON.stringify(error)).not.toContain(SECRET);
  });
});

describe('unusable answers from a provider', () => {
  it.each([['spaces', '   '], ['a newline', '\n'], ['mixed whitespace', ' \n\t ']])(
    'rejects a chat answer that is only %s',
    async (_name, content) => {
      server.setHandler(() => chatReply(content));
      const error = await createChatModel(chatConfig())
        .complete([{ role: 'user', content: 'x' }])
        .catch((e: unknown) => e);
      expect((error as AiProviderError).kind).toBe('invalid_response');
    },
  );

  it('rejects a streamed answer that is only whitespace', async () => {
    server.setHandler(() => streamReply(['  ', '\n']));
    const error = await (async () => {
      for await (const _ of createChatModel(chatConfig()).stream([{ role: 'user', content: 'x' }])) void _;
    })().catch((e: unknown) => e);
    expect((error as AiProviderError).kind).toBe('invalid_response');
  });

  it('still accepts an answer that merely starts or ends with whitespace', async () => {
    server.setHandler(() => chatReply('\nHello \n'));
    const answer = await createChatModel(chatConfig()).complete([{ role: 'user', content: 'x' }]);
    expect(answer.content.trim()).toBe('Hello');
  });
});

describe('embedding model', () => {
  const vec = (i: number) => [i, i + 0.5, i + 1];

  const raw = (data: unknown) => ({
    status: 200,
    body: { object: 'list', model: 'fake', data, usage: { prompt_tokens: 1, total_tokens: 1 } },
  });

  it.each([
    ['an item without an index', [{ embedding: [1, 2, 3] }, { embedding: [1, 2, 3] }]],
    ['duplicate indexes', [{ index: 0, embedding: [1, 2, 3] }, { index: 0, embedding: [1, 2, 3] }]],
    ['indexes that do not start at zero', [{ index: 1, embedding: [1, 2, 3] }, { index: 2, embedding: [1, 2, 3] }]],
    ['a missing vector', [{ index: 0, embedding: null }, { index: 1, embedding: [1, 2, 3] }]],
    ['a vector that is not a list', [{ index: 0, embedding: 'abc' }, { index: 1, embedding: [1, 2, 3] }]],
    ['a vector with non-numbers', [{ index: 0, embedding: [1, 'x', 3] }, { index: 1, embedding: [1, 2, 3] }]],
    ['a vector with a missing value', [{ index: 0, embedding: [1, null, 3] }, { index: 1, embedding: [1, 2, 3] }]],
  ])('rejects %s as an invalid response, never as a crash', async (_name, data) => {
    server.setHandler(() => raw(data));
    const error = await createEmbeddingModel(embeddingConfig())
      .embed(['a', 'b'])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).kind).toBe('invalid_response');
  });

  it('requests the configured dimensions and returns vectors with usage', async () => {
    server.setHandler((req) =>
      embeddingReply((req.body.input as string[]).map((_, i) => vec(i))),
    );
    const result = await createEmbeddingModel(embeddingConfig()).embed(['a', 'b']);
    expect(result.vectors).toEqual([vec(0), vec(1)]);
    expect(result.usage.totalTokens).toBe(2);
    expect(server.requests[0].path).toBe('/v1/embeddings');
    expect(server.requests[0].body).toMatchObject({
      model: 'test/embed-model',
      input: ['a', 'b'],
      dimensions: 3,
    });
  });

  it('splits large inputs into batches and keeps the order', async () => {
    server.setHandler((req) =>
      embeddingReply(
        (req.body.input as string[]).map((text) => [Number(text), 0, 0]),
        'fake',
        true, // the provider returns items in reverse order; "index" must be honoured
      ),
    );
    const texts = Array.from({ length: 130 }, (_, i) => String(i));
    const { vectors } = await createEmbeddingModel(embeddingConfig()).embed(texts);
    expect(server.requests.map((r) => (r.body.input as string[]).length)).toEqual([64, 64, 2]);
    expect(vectors.map((v) => v[0])).toEqual(texts.map(Number));
  });

  it('fails loudly when the provider returns another vector size', async () => {
    server.setHandler(() => embeddingReply([[1, 2, 3, 4]]));
    const error = await createEmbeddingModel(embeddingConfig())
      .embed(['a'])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).kind).toBe('dimension_mismatch');
    expect((error as AiProviderError).message).toMatch(/size 4.*expected 3/s);
  });

  it('fails when the provider returns fewer vectors than inputs', async () => {
    server.setHandler(() => embeddingReply([[1, 2, 3]]));
    const error = await createEmbeddingModel(embeddingConfig())
      .embed(['a', 'b'])
      .catch((e: unknown) => e);
    expect((error as AiProviderError).kind).toBe('invalid_response');
  });

  it('omits the dimensions parameter for providers that reject it', async () => {
    server.setHandler(() => embeddingReply([[1, 2, 3]]));
    await createEmbeddingModel(embeddingConfig({ sendDimensions: false })).embed(['a']);
    expect(server.requests[0].body).not.toHaveProperty('dimensions');
  });

  it('makes no request for an empty list and rejects empty strings', async () => {
    const model = createEmbeddingModel(embeddingConfig());
    expect((await model.embed([])).vectors).toEqual([]);
    expect(server.requests).toHaveLength(0);
    const error = await model.embed(['ok', '  ']).catch((e: unknown) => e);
    expect((error as AiProviderError).kind).toBe('bad_request');
    expect(server.requests).toHaveLength(0);
  });

  it('maps provider errors like the chat model does', async () => {
    server.setHandler(() => errorReply(429, 'slow down'));
    const error = await createEmbeddingModel(embeddingConfig())
      .embed(['a'])
      .catch((e: unknown) => e);
    expect((error as AiProviderError).kind).toBe('rate_limited');
  });
});


describe('chat streaming', () => {
  const collect = async (iterable: AsyncIterable<string>) => {
    const parts: string[] = [];
    for await (const part of iterable) parts.push(part);
    return parts;
  };
  const question = [{ role: 'user' as const, content: 'hi' }];

  it('yields the text parts in order and asks the provider for a stream', async () => {
    server.setHandler(() => streamReply(['Hel', 'lo ', 'world']));
    const parts = await collect(createChatModel(chatConfig()).stream(question, { temperature: 0.1 }));
    expect(parts).toEqual(['Hel', 'lo ', 'world']);
    expect(server.requests[0].body).toMatchObject({ stream: true, model: 'test/chat-model', temperature: 0.1 });
    expect(server.requests[0].headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  it('skips chunks without text (role announcement, finish marker)', async () => {
    server.setHandler(() => streamReply(['a', '', 'b']));
    expect(await collect(createChatModel(chatConfig()).stream(question))).toEqual(['a', 'b']);
  });

  it.each([
    [401, 'authentication'],
    [429, 'rate_limited'],
    [503, 'unavailable'],
    [400, 'bad_request'],
  ] as const)('reports HTTP %i before the stream starts as "%s"', async (status, kind) => {
    server.setHandler(() => errorReply(status, 'nope'));
    const error = await collect(createChatModel(chatConfig()).stream(question)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).kind).toBe(kind);
  });

  it('reports a connection lost in the middle of the answer', async () => {
    server.setHandler(() => streamReply(['one', 'two', 'three'], { cutAfter: 3, delayMs: 40 }));
    const seen: string[] = [];
    const error = await (async () => {
      try {
        for await (const part of createChatModel(chatConfig()).stream(question)) seen.push(part);
      } catch (e) {
        return e;
      }
    })();
    expect(seen).toEqual(['one', 'two']); // what arrived before the cut was delivered
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).kind).toBe('unavailable');
  });

  it('rejects an answer that has no text at all', async () => {
    server.setHandler(() => streamReply([]));
    const error = await collect(createChatModel(chatConfig()).stream(question)).catch((e: unknown) => e);
    expect((error as AiProviderError).kind).toBe('invalid_response');
  });

  it('stops reading when the caller cancels', async () => {
    server.setHandler(() => streamReply(Array.from({ length: 50 }, (_, i) => `p${i} `), { delayMs: 20 }));
    const controller = new AbortController();
    const seen: string[] = [];
    for await (const part of createChatModel(chatConfig()).stream(question, { signal: controller.signal })) {
      seen.push(part);
      if (seen.length === 2) controller.abort();
    }
    expect(seen.length).toBeLessThan(10);
  });

  it('never leaks the API key into stream errors', async () => {
    server.setHandler(() => errorReply(401, 'invalid key'));
    const error = (await collect(createChatModel(chatConfig()).stream(question)).catch((e: unknown) => e)) as AiProviderError;
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect(error.message).not.toContain(SECRET);
  });
});
