import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from '../supabase/supabase.config.js';
import type { AuthUser, TokenVerifier } from './auth.types.js';

export class SupabaseTokenVerifier implements TokenVerifier {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseConfig) {
    this.client = createClient(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async verify(token: string): Promise<AuthUser | null> {
    // getClaims checks the signature (against the project's public keys) and the expiry.
    const { data, error } = await this.client.auth.getClaims(token);
    const subject = data?.claims?.sub;
    if (error || !subject) return null;
    return { id: subject, token };
  }
}
