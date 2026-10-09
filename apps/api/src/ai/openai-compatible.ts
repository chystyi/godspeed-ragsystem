import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatModel,
  ChatOptions,
  ChatTurn,
  EmbeddingModel,
  EmbeddingResult,
} from './ai.types.js';
import { AiProviderError } from './errors.js';

/** Connection settings shared by chat and embeddings. */
export interface ProviderConnection {
  baseURL: string;
  apiKey: string;
  timeoutMs: number;
  /** Retries on 429, 5xx and connection errors (handled by the SDK, with backoff). */
  maxRetries: number;
}

export interface ChatConfig extends ProviderConnection {
  model: string;
}

export interface EmbeddingConfig extends ProviderConnection {
  model: string;
  dimensions: number;
  /** Some providers reject the `dimensions` parameter; they can only be used if their
   *  native size equals `dimensions`. */
  sendDimensions: boolean;
}

/** Texts per embeddings request; keeps requests small and within provider limits. */
export const EMBEDDING_BATCH_SIZE = 64;

function client(config: ProviderConnection): OpenAI {
  return new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
    maxRetries: config.maxRetries,
  });
}

/** Translate SDK errors into our own kinds. Only status and provider message are kept. */
export function toAiProviderError(error: unknown, operation: string): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    const detail = `${operation} failed${status ? ` (HTTP ${status})` : ''}: ${error.message}`;
    if (status === 401 || status === 403) return new AiProviderError('authentication', detail, status, { cause: error });
    if (status === 429) return new AiProviderError('rate_limited', detail, status, { cause: error });
    if (status !== undefined && status >= 400 && status < 500) {
      return new AiProviderError('bad_request', detail, status, { cause: error });
    }
    return new AiProviderError('unavailable', detail, status, { cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new AiProviderError('unavailable', `${operation} failed: ${message}`, undefined, {
    cause: error,
  });
}

function requestBody(model: string, messages: ChatTurn[], options: ChatOptions) {
  return {
    model,
    messages,
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
  };
}

export function createChatModel(config: ChatConfig): ChatModel {
  const sdk = client(config);
  return {
    async *stream(messages: ChatTurn[], options: ChatOptions = {}): AsyncGenerator<string> {
      let response: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
      try {
        response = await sdk.chat.completions.create(
          { ...requestBody(config.model, messages, options), stream: true },
          { signal: options.signal },
        );
      } catch (error) {
        throw toAiProviderError(error, 'chat stream');
      }
      let produced = false;
      try {
        for await (const chunk of response) {
          const text = chunk.choices[0]?.delta?.content;
          if (text) {
            produced = true;
            yield text;
          }
        }
      } catch (error) {
        if (options.signal?.aborted) return; // the caller left on purpose
        throw toAiProviderError(error, 'chat stream');
      }
      if (!produced && !options.signal?.aborted) {
        throw new AiProviderError('invalid_response', 'chat stream returned no content');
      }
    },

    async complete(messages: ChatTurn[], options: ChatOptions = {}): Promise<ChatCompletion> {
      let response: OpenAI.Chat.Completions.ChatCompletion;
      try {
        response = await sdk.chat.completions.create(
          requestBody(config.model, messages, options),
          { signal: options.signal },
        );
      } catch (error) {
        throw toAiProviderError(error, 'chat completion');
      }
      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new AiProviderError('invalid_response', 'chat completion returned no content');
      }
      const usage = response.usage;
      return {
        content,
        model: response.model,
        ...(usage && {
          usage: {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          },
        }),
      };
    },
  };
}

export function createEmbeddingModel(config: EmbeddingConfig): EmbeddingModel {
  const sdk = client(config);

  async function embedBatch(batch: string[]): Promise<{ vectors: number[][]; tokens: number }> {
    let response: OpenAI.CreateEmbeddingResponse;
    try {
      response = await sdk.embeddings.create({
        model: config.model,
        input: batch,
        ...(config.sendDimensions && { dimensions: config.dimensions }),
      });
    } catch (error) {
      throw toAiProviderError(error, 'embeddings request');
    }
    if (response.data.length !== batch.length) {
      throw new AiProviderError(
        'invalid_response',
        `embeddings request returned ${response.data.length} vectors for ${batch.length} texts`,
      );
    }
    // Providers may return items out of order; `index` is the contract.
    const vectors = [...response.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    for (const vector of vectors) {
      if (vector.length !== config.dimensions) {
        throw new AiProviderError(
          'dimension_mismatch',
          `model "${config.model}" returned vectors of size ${vector.length}, expected ` +
            `${config.dimensions} (AI_EMBEDDING_DIMENSIONS must match the database column; ` +
            `choose a model that supports the "dimensions" parameter or change both)`,
        );
      }
    }
    return { vectors, tokens: response.usage?.total_tokens ?? 0 };
  }

  return {
    model: config.model,
    dimensions: config.dimensions,
    async embed(texts: string[]): Promise<EmbeddingResult> {
      if (texts.some((text) => text.trim() === '')) {
        throw new AiProviderError('bad_request', 'cannot embed an empty text');
      }
      const vectors: number[][] = [];
      let totalTokens = 0;
      for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
        const result = await embedBatch(texts.slice(start, start + EMBEDDING_BATCH_SIZE));
        vectors.push(...result.vectors);
        totalTokens += result.tokens;
      }
      return { vectors, usage: { totalTokens } };
    },
  };
}
