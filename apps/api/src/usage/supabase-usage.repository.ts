import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from '../supabase/supabase.config.js';
import type { UsageEvent, UsageKind, UsageRepository, UsageRepositoryFactory, UsageRow } from './usage.types.js';

interface UsageRowRecord {
  day: string;
  kind: UsageKind;
  model: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
}

class SupabaseUsageRepository implements UsageRepository {
  constructor(private readonly client: SupabaseClient) {}

  async record(event: UsageEvent): Promise<void> {
    const { error } = await this.client.rpc('record_usage', {
      p_kind: event.kind,
      p_model: event.model,
      p_prompt_tokens: event.promptTokens,
      p_completion_tokens: event.completionTokens,
    });
    if (error) throw new Error(`record_usage failed: ${error.message}`);
  }

  async list(days: number): Promise<UsageRow[]> {
    const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await this.client
      .from('usage_daily')
      .select('day, kind, model, requests, prompt_tokens, completion_tokens')
      .gte('day', since)
      .order('day', { ascending: true })
      .limit(5000);
    if (error) throw new Error(`usage query failed: ${error.message}`);
    return (data as UsageRowRecord[]).map((row) => ({
      day: row.day,
      kind: row.kind,
      model: row.model,
      requests: Number(row.requests),
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
    }));
  }
}

/** Every repository acts with the token of the signed-in user, so row level security applies. */
export class SupabaseUsageRepositoryFactory implements UsageRepositoryFactory {
  constructor(private readonly config: SupabaseConfig) {}

  forUser(accessToken: string): UsageRepository {
    return new SupabaseUsageRepository(
      createClient(this.config.url, this.config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      }),
    );
  }
}
