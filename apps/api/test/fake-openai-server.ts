import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

export type Reply = { status: number; body: unknown };
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
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.baseURL = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}/v1`;
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
