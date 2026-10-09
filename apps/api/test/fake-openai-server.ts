import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

export type Reply =
  | { status: number; body: unknown; sse?: undefined }
  | {
      status: number;
      /** Server-sent events: each entry is the JSON of one chunk; "[DONE]" is appended. */
      sse: unknown[];
      /** Pause between chunks, to test cancellation. */
      delayMs?: number;
      /** Drop the connection after this many chunks, to test a broken stream. */
      cutAfter?: number;
    };
export type Handler = (request: RecordedRequest) => Reply;

/** A tiny stand-in for any OpenAI-compatible provider, so the real SDK runs in tests. */
export class FakeOpenAiServer {
  readonly requests: RecordedRequest[] = [];
  private server: Server | undefined;
  private handler: Handler = () => ({ status: 500, body: { error: { message: 'no handler' } } });

  /** Base URL including the /v1 prefix, as users configure it. */
  baseURL = '';

  setHandler(handler: Handler): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const recorded: RecordedRequest = {
          method: req.method ?? '',
          path: req.url ?? '',
          headers: req.headers,
          body,
        };
        this.requests.push(recorded);
        const reply = this.handler(recorded);
        if (reply.sse) {
          void this.writeStream(res, reply);
          return;
        }
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.baseURL = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}/v1`;
  }

  private async writeStream(
    res: import('node:http').ServerResponse,
    reply: Extract<Reply, { sse: unknown[] }>,
  ): Promise<void> {
    res.writeHead(reply.status, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (const [i, chunk] of reply.sse.entries()) {
      if (reply.cutAfter !== undefined && i >= reply.cutAfter) {
        res.destroy();
        return;
      }
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    }
    if (!res.destroyed) res.end('data: [DONE]\n\n');
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

export function chatReply(content: string | null, model = 'fake-chat'): Reply {
  return {
    status: 200,
    body: {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 0,
      model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
    },
  };
}

export function embeddingReply(vectors: number[][], model = 'fake-embed', shuffle = false): Reply {
  const data = vectors.map((embedding, index) => ({ object: 'embedding', index, embedding }));
  if (shuffle) data.reverse();
  return {
    status: 200,
    body: { object: 'list', model, data, usage: { prompt_tokens: vectors.length, total_tokens: vectors.length } },
  };
}

export function errorReply(status: number, message: string): Reply {
  return { status, body: { error: { message, type: 'error' } } };
}

/** A streamed chat answer: a role chunk, one chunk per text part, and a finishing chunk. */
export function streamReply(parts: string[], over: { delayMs?: number; cutAfter?: number } = {}): Reply {
  const chunk = (delta: object, finish: string | null = null) => ({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'fake-chat',
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  return {
    status: 200,
    sse: [
      chunk({ role: 'assistant', content: '' }),
      ...parts.map((text) => chunk({ content: text })),
      chunk({}, 'stop'),
    ],
    ...over,
  };
}
