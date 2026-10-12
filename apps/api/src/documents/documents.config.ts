import { z } from 'zod';
import { ConfigError } from '../config/ai-config.js';

const schema = z.object({
  // Create, update and re-index each call the (paid) embedding model.
  DOC_WRITES_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(30),
  // Writes of one user that may be embedding at the same time (each holds memory and model calls).
  DOC_MAX_CONCURRENT_WRITES: z.coerce.number().int().min(1).max(20).default(3),
});

export interface DocumentLimits {
  writesPerMinute: number;
  maxConcurrentWrites: number;
}

export function loadDocumentLimits(env: Record<string, string | undefined>): DocumentLimits {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([key, value]) => key.startsWith('DOC_') && value !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new ConfigError(`invalid environment variables: ${names.join(', ')}`);
  }
  return {
    writesPerMinute: parsed.data.DOC_WRITES_PER_MINUTE,
    maxConcurrentWrites: parsed.data.DOC_MAX_CONCURRENT_WRITES,
  };
}
