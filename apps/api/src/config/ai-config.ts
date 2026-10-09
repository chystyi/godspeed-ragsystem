import { z } from 'zod';
import type { ChatConfig, EmbeddingConfig } from '../ai/openai-compatible.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const bool = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const schema = z.object({
  AI_BASE_URL: z.string().url(),
  AI_API_KEY: z.string().min(1),
  AI_CHAT_MODEL: z.string().min(1),
  AI_EMBEDDING_MODEL: z.string().min(1),
  AI_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  AI_EMBEDDING_SEND_DIMENSIONS: bool.default(true),
  // Optional: embeddings from a different provider than chat.
  AI_EMBEDDING_BASE_URL: z.string().url().optional(),
  AI_EMBEDDING_API_KEY: z.string().min(1).optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
});

export interface AiConfig {
  chat: ChatConfig;
  embeddings: EmbeddingConfig;
}

/**
 * Read and validate the AI settings. Empty strings count as unset, so `FOO=` in `.env.example`
 * copies behave like a missing variable. Error messages list variable names only, never values.
 */
export function loadAiConfig(env: Record<string, string | undefined>): AiConfig {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([key, value]) => key.startsWith('AI_') && value !== ''),
  );
  const parsed = schema.safeParse(
    // A deliberately empty AI_API_KEY should be reported, not silently dropped.
    env.AI_API_KEY === '' ? { ...cleaned, AI_API_KEY: '' } : cleaned,
  );
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new ConfigError(`invalid or missing environment variables: ${names.join(', ')}`);
  }
  const v = parsed.data;
  const connection = { timeoutMs: v.AI_TIMEOUT_MS, maxRetries: v.AI_MAX_RETRIES };
  return {
    chat: { baseURL: v.AI_BASE_URL, apiKey: v.AI_API_KEY, model: v.AI_CHAT_MODEL, ...connection },
    embeddings: {
      baseURL: v.AI_EMBEDDING_BASE_URL ?? v.AI_BASE_URL,
      apiKey: v.AI_EMBEDDING_API_KEY ?? v.AI_API_KEY,
      model: v.AI_EMBEDDING_MODEL,
      dimensions: v.AI_EMBEDDING_DIMENSIONS,
      sendDimensions: v.AI_EMBEDDING_SEND_DIMENSIONS,
      ...connection,
    },
  };
}
