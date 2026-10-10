import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { argsOf, fakeSupabase, methodsOf } from '../../test/fake-supabase.js';
import { LimitReachedError } from '../http/limit-error.js';
import { DocumentNotFoundError, StaleIndexError } from './errors.js';
import { SupabaseDocumentsRepositoryFactory } from './supabase-documents.repository.js';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

const row = {
  id: 'd1',
  title: 'Guide',
  content: 'Body',
  tags: ['a'],
  indexing_status: 'indexed',
  indexing_error: null,
  indexed_at: '2026-10-09T12:00:00Z',
  content_hash: 'h',
  created_at: '2026-10-09T11:00:00Z',
  updated_at: '2026-10-09T12:00:00Z',
};

const config = { url: 'https://example.supabase.co', anonKey: 'anon-key' };

function repository(...results: Parameters<typeof fakeSupabase>) {
  const fake = fakeSupabase(...results);
  vi.mocked(createClient).mockReturnValue(fake.client as never);
  return { repository: new SupabaseDocumentsRepositoryFactory(config).forUser('user-jwt'), fake };
}

beforeEach(() => vi.mocked(createClient).mockReset());

describe('SupabaseDocumentsRepositoryFactory', () => {
  it("talks to the database with the user's own token and no stored session", () => {
    repository();
    expect(createClient).toHaveBeenCalledWith(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: 'Bearer user-jwt' } },
    });
  });

  it('creates a separate client per user', () => {
    const fake = fakeSupabase();
    vi.mocked(createClient).mockReturnValue(fake.client as never);
    const factory = new SupabaseDocumentsRepositoryFactory(config);
    factory.forUser('token-a');
    factory.forUser('token-b');
    const headers = vi.mocked(createClient).mock.calls.map((call) => (call[2] as { global: { headers: object } }).global.headers);
    expect(headers).toEqual([{ Authorization: 'Bearer token-a' }, { Authorization: 'Bearer token-b' }]);
  });
});

describe('documents repository', () => {
  it('creates a document and maps the row to the domain record', async () => {
    const { repository: repo, fake } = repository({ data: row });
    const record = await repo.create({ title: 'Guide', content: 'Body', tags: ['a'] });
    expect(record).toEqual({
      id: 'd1',
      title: 'Guide',
      content: 'Body',
      tags: ['a'],
      indexingStatus: 'indexed',
      indexingError: null,
      indexedAt: '2026-10-09T12:00:00Z',
      contentHash: 'h',
      createdAt: '2026-10-09T11:00:00Z',
      updatedAt: '2026-10-09T12:00:00Z',
    });
    expect(fake.calls[0].name).toBe('documents');
    expect(argsOf(fake.calls[0], 'insert')).toEqual([{ title: 'Guide', content: 'Body', tags: ['a'] }]);
    expect(methodsOf(fake.calls[0])).toEqual(['insert', 'select', 'single']);
  });

  it('does not add a user_id filter: isolation is the database policy, not this code', async () => {
    const { repository: repo, fake } = repository({ data: row });
    await repo.findById('d1');
    expect(argsOf(fake.calls[0], 'eq')).toEqual(['id', 'd1']);
    expect(JSON.stringify(fake.calls)).not.toContain('user_id');
  });

  it('answers null for a document that is not there (or not yours)', async () => {
    const { repository: repo } = repository({ data: null });
    expect(await repo.findById('d1')).toBeNull();
  });

  it('turns a database error into an exception that names the operation and code, not the data', async () => {
    const { repository: repo } = repository({ error: { message: 'permission denied', code: '42501' } });
    await expect(repo.findById('d1')).rejects.toThrow(/loading the document failed: permission denied \(42501\)/);
  });

  it('lists newest first with a safety limit and without full texts', async () => {
    const { repository: repo, fake } = repository({
      data: [{ ...row, preview: 'Body' }],
    });
    const items = await repo.list();
    expect(items).toEqual([
      expect.objectContaining({ id: 'd1', preview: 'Body', indexingStatus: 'indexed' }),
    ]);
    expect(items[0]).not.toHaveProperty('content');
    expect(argsOf(fake.calls[0], 'order')).toEqual(['updated_at', { ascending: false }]);
    expect(argsOf(fake.calls[0], 'limit')).toEqual([200]);
    expect(String(argsOf(fake.calls[0], 'select')?.[0])).not.toMatch(/\bcontent\b/);
  });

  it('update returns null when nothing matched and the record when it did', async () => {
    const miss = repository({ data: [] });
    expect(await miss.repository.update('d1', { title: 'x' })).toBeNull();
    const hit = repository({ data: [row] });
    expect((await hit.repository.update('d1', { title: 'x' }))?.id).toBe('d1');
    expect(argsOf(hit.fake.calls[0], 'update')).toEqual([{ title: 'x' }]);
  });

  it('delete reports whether a row was removed', async () => {
    expect(await repository({ data: [{ id: 'd1' }] }).repository.delete('d1')).toBe(true);
    expect(await repository({ data: [] }).repository.delete('d1')).toBe(false);
  });

  it('stores chunks through the atomic function with the expected arguments', async () => {
    const { repository: repo, fake } = repository({ data: null });
    await repo.replaceChunks('d1', {
      embeddingModel: 'm',
      contentHash: 'h',
      contentDigest: 'digest-1',
      chunks: [{ index: 0, content: 'c', tokenCount: 1, embedding: [0.1, 0.2] }],
    });
    expect(fake.calls[0]).toMatchObject({
      kind: 'rpc',
      name: 'replace_document_chunks',
      args: {
        p_document_id: 'd1',
        p_embedding_model: 'm',
        p_content_hash: 'h',
        p_content_digest: 'digest-1',
        p_chunks: [{ index: 0, content: 'c', tokenCount: 1, embedding: [0.1, 0.2] }],
      },
    });
  });

  it('maps "no such document" from the database to DocumentNotFoundError', async () => {
    const { repository: repo } = repository({ error: { message: 'document x not found', code: 'P0002' } });
    await expect(repo.replaceChunks('d1', { embeddingModel: 'm', contentHash: 'h', contentDigest: 'd', chunks: [] })).rejects.toBeInstanceOf(
      DocumentNotFoundError,
    );
  });

  it('does not hide other database errors behind "not found"', async () => {
    const { repository: repo } = repository({ error: { message: 'boom', code: 'XX000' } });
    await expect(repo.replaceChunks('d1', { embeddingModel: 'm', contentHash: 'h', contentDigest: 'd', chunks: [] })).rejects.toThrow(/storing the chunks failed/);
  });

  it('maps a stale result (the document changed while it was embedded) to StaleIndexError', async () => {
    const { repository: repo } = repository({ error: { message: 'changed while it was being indexed', code: 'P0003' } });
    await expect(repo.replaceChunks('d1', { embeddingModel: 'm', contentHash: 'h', contentDigest: 'd', chunks: [] })).rejects.toBeInstanceOf(
      StaleIndexError,
    );
  });

  it('turns the per-user document cap into a limit error, not a server error', async () => {
    const { repository: repo } = repository({ error: { message: 'documents limit of 200 reached', code: 'P0004' } });
    await expect(repo.create({ title: 't', content: 'c', tags: [] })).rejects.toBeInstanceOf(LimitReachedError);
  });

  it('records an indexing failure through the function, naming the version it is about', async () => {
    const { repository: repo, fake } = repository({ data: null });
    await repo.markIndexingFailed('d1', 'the AI provider is unavailable', 'digest-1');
    expect(fake.calls[0]).toMatchObject({
      kind: 'rpc',
      name: 'mark_indexing_failed',
      args: { p_document_id: 'd1', p_error: 'the AI provider is unavailable', p_content_digest: 'digest-1' },
    });
  });

  it('does not write the bookkeeping columns itself any more', async () => {
    const { repository: repo, fake } = repository({ data: null });
    await repo.markIndexingFailed('d1', 'x', 'd');
    expect(JSON.stringify(fake.calls)).not.toContain('indexing_status');
  });
});
