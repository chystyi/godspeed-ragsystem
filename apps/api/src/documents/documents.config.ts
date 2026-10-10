import { z } from 'zod';
import { ConfigError } from '../config/ai-config.js';

const schema = z.object({
  // Create, update and re-index each call the (paid) embedding model.
  DOC_WRITES_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(30),
});

export interface DocumentLimits {
  writesPerMinute: number;
}

export function loadDocumentLimits(env: Record<string, string | undefined>): DocumentLimits {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([key, value]) => key === 'DOC_WRITES_PER_MINUTE' && value !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) throw new ConfigError('invalid environment variables: DOC_WRITES_PER_MINUTE');
  return { writesPerMinute: parsed.data.DOC_WRITES_PER_MINUTE };
}
