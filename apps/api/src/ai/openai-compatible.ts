import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatModel,
  ChatOptions,
  ChatTurn,
  EmbedOptions,
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

/**
 * The vectors in input order, taken from the response only if its shape can be trusted: exactly
 * one item per text, each with an `index` (0..n-1, no repeats) and a list of numbers. Anything
 * else would risk attaching a vector to the wrong text, so it is an error.
 */
function orderedVectors(data: unknown, expected: number): number[][] {
  const invalid = (reason: string) =>
    new AiProviderError('invalid_response', `embeddings request returned an unusable response: ${reason}`);
  if (!Array.isArray(data) || data.length !== expected) {
    throw invalid(`${Array.isArray(data) ? data.length : 'no'} vectors for ${expected} texts`);
  }
  const vectors: (number[] | undefined)[] = new Array(expected).fill(undefined);
  for (const item of data as { index?: unknown; embedding?: unknown }[]) {
    const { index, embedding } = item ?? {};
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= expected) throw invalid('bad index');
    if (vectors[index as number] !== undefined) throw invalid('repeated index');
    if (!Array.isArray(embedding) || !embedding.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      throw invalid('a vector is not a list of numbers');
    }
    vectors[index as number] = embedding as number[];
  }
  return vectors as number[][];
}

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
  // The SDK reads the body itself; data it cannot decode surfaces as a TypeError or similar.
  // A connection dropped while the body is read is also a TypeError ("terminated"): that is not bad data.
  const networkProblem = /terminated|fetch failed|socket|ECONN|ETIMEDOUT|network/i.test(message);
  if (!networkProblem && (error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError)) {
    return new AiProviderError('invalid_response', `${operation} returned data that could not be read`, undefined, {
      cause: error,
    });
  }
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
            if (text.trim() !== '') produced = true;
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
      if (!content || content.trim() === '') {
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

  async function embedBatch(batch: string[], signal?: AbortSignal): Promise<{ vectors: number[][]; tokens: number }> {
    let response: OpenAI.CreateEmbeddingResponse;
    try {
      response = await sdk.embeddings.create(
        {
          model: config.model,
          input: batch,
          ...(config.sendDimensions && { dimensions: config.dimensions }),
        },
        { signal },
      );
    } catch (error) {
      throw toAiProviderError(error, 'embeddings request');
    }
    const vectors = orderedVectors(response.data, batch.length);
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
    async embed(texts: string[], options: EmbedOptions = {}): Promise<EmbeddingResult> {
      if (texts.some((text) => text.trim() === '')) {
        throw new AiProviderError('bad_request', 'cannot embed an empty text');
      }
      const vectors: number[][] = [];
      let totalTokens = 0;
      for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
        const result = await embedBatch(texts.slice(start, start + EMBEDDING_BATCH_SIZE), options.signal);
        vectors.push(...result.vectors);
        totalTokens += result.tokens;
      }
      return { vectors, usage: { totalTokens } };
    },
  };
}
