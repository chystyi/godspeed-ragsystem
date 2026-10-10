import { z } from 'zod';
import { ConfigError } from '../config/ai-config.js';

const bool = z.enum(['true', 'false']).transform((value) => value === 'true');

const schema = z.object({
  // How many passages go into the prompt: ~250 tokens each.
  CHAT_TOP_K: z.coerce.number().int().min(1).max(20).default(5),
  // Below this cosine similarity a passage is not considered related. Measured with
  // text-embedding-3-small: related questions score 0.34-0.61, unrelated ones 0.02-0.13.
  CHAT_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.25),
  CHAT_HISTORY_MESSAGES: z.coerce.number().int().min(0).max(50).default(10),
  // One extra, cheap model call that makes follow-up questions searchable.
  CHAT_REWRITE_QUERIES: bool.default(true),
  CHAT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(20),
  // Answers one user may have streaming at the same time (each holds a model call open).
  CHAT_MAX_CONCURRENT_STREAMS: z.coerce.number().int().min(1).max(20).default(3),
});

export interface ChatConfig {
  topK: number;
  minSimilarity: number;
  historyMessages: number;
  rewriteQueries: boolean;
  rateLimitPerMinute: number;
  maxConcurrentStreams: number;
}

export const CHAT_CONFIG = Symbol('CHAT_CONFIG');

export function loadChatConfig(env: Record<string, string | undefined>): ChatConfig {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([key, value]) => key.startsWith('CHAT_') && value !== ''),
  );
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new ConfigError(`invalid environment variables: ${names.join(', ')}`);
  }
  const v = parsed.data;
  return {
    topK: v.CHAT_TOP_K,
    minSimilarity: v.CHAT_MIN_SIMILARITY,
    historyMessages: v.CHAT_HISTORY_MESSAGES,
    rewriteQueries: v.CHAT_REWRITE_QUERIES,
    rateLimitPerMinute: v.CHAT_RATE_LIMIT_PER_MINUTE,
    maxConcurrentStreams: v.CHAT_MAX_CONCURRENT_STREAMS,
  };
}
