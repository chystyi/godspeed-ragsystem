import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { argsOf, fakeSupabase, methodsOf } from '../../test/fake-supabase.js';
import { SupabaseUsageRepositoryFactory } from './supabase-usage.repository.js';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

const config = { url: 'https://example.supabase.co', anonKey: 'anon-key' };

function repository(...results: Parameters<typeof fakeSupabase>) {
  const fake = fakeSupabase(...results);
  vi.mocked(createClient).mockReturnValue(fake.client as never);
  return { repository: new SupabaseUsageRepositoryFactory(config).forUser('user-jwt'), fake };
}

beforeEach(() => vi.mocked(createClient).mockReset());

describe('usage repository', () => {
  it("acts with the user's own token", () => {
    repository();
    expect(createClient).toHaveBeenCalledWith(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: 'Bearer user-jwt' } },
    });
  });

  it('records through the database function, which counts it up', async () => {
    const { repository: repo, fake } = repository({ data: null });
    await repo.record({ kind: 'chat', model: 'm/one', promptTokens: 120, completionTokens: 30 });
    expect(fake.calls[0]).toMatchObject({
      kind: 'rpc',
      name: 'record_usage',
      args: { p_kind: 'chat', p_model: 'm/one', p_prompt_tokens: 120, p_completion_tokens: 30 },
    });
  });

  it('reports a database error', async () => {
    const { repository: repo } = repository({ error: { message: 'boom', code: 'XX000' } });
    await expect(repo.record({ kind: 'chat', model: 'm', promptTokens: 1, completionTokens: 1 })).rejects.toThrow(/record_usage/);
  });

  it('lists the rows of the period, oldest first, as numbers', async () => {
    const { repository: repo, fake } = repository({
      data: [{ day: '2026-10-12', kind: 'embedding', model: 'e', requests: '2', prompt_tokens: '900', completion_tokens: 0 }],
    });
    expect(await repo.list(7)).toEqual([
      { day: '2026-10-12', kind: 'embedding', model: 'e', requests: 2, promptTokens: 900, completionTokens: 0 },
    ]);
    const call = fake.calls[0];
    expect(call.name).toBe('usage_daily');
    expect(methodsOf(call)).toEqual(expect.arrayContaining(['select', 'gte', 'order', 'limit']));
    expect(argsOf(call, 'gte')?.[0]).toBe('day');
    expect(argsOf(call, 'gte')?.[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(argsOf(call, 'order')).toEqual(['day', { ascending: true }]);
  });
});
