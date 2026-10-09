import { z } from 'zod';
import { ConfigError } from '../config/ai-config.js';

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
});

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export const SUPABASE_CONFIG = Symbol('SUPABASE_CONFIG');

/** Only the public (anon) key is needed: all database access happens with the user's token. */
export function loadSupabaseConfig(env: Record<string, string | undefined>): SupabaseConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new ConfigError(`invalid or missing environment variables: ${names.join(', ')}`);
  }
  return { url: parsed.data.SUPABASE_URL, anonKey: parsed.data.SUPABASE_ANON_KEY };
}
