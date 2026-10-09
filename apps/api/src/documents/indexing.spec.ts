import { Logger } from '@nestjs/common';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '../../test/in-memory-documents.js';
import type { EmbeddingModel } from '../ai/ai.types.js';
import { AiProviderError } from '../ai/errors.js';
import { IndexingService } from './indexing.service.js';

class FakeEmbedder implements EmbeddingModel {
  model = 'fake/embed-v1';
  dimensions = 4;
  calls: string[][] = [];
  failWith: Error | undefined;
  async embed(texts: string[]) {
    this.calls.push(texts);
    if (this.failWith) throw this.failWith;
    return { vectors: texts.map((t) => [t.length, 0, 0, 1]), usage: { totalTokens: texts.length } };
  }
}

let db: InMemoryDatabase;
let embedder: FakeEmbedder;
let indexing: IndexingService;
const repo = () => db.repositoryFor('alice');

beforeAll(() => {
  Logger.overrideLogger(false); // failures are expected here and would only clutter the output
});

beforeEach(() => {
  db = new InMemoryDatabase();
  embedder = new FakeEmbedder();
  indexing = new IndexingService(embedder);
});

async function newDoc(content = 'First paragraph.\n\nSecond paragraph.', title = 'Guide') {
  return repo().create({ title, content, tags: [] });
}

describe('IndexingService', () => {
  it('chunks, embeds with the title as context and stores the vectors', async () => {
    const doc = await newDoc();
    await indexing.index(repo(), doc);
    expect(embedder.calls).toHaveLength(1);
    expect(embedder.calls[0][0]).toBe('Guide\n\nFirst paragraph.\n\nSecond paragraph.');
    expect(db.chunks).toHaveLength(1);
    expect(db.chunks[0]).toMatchObject({ embeddingModel: 'fake/embed-v1', content: doc.content });
    const stored = await repo().findById(doc.id);
    expect(stored).toMatchObject({ indexingStatus: 'indexed', indexingError: null });
    expect(stored?.indexedAt).not.toBeNull();
  });

  it('does not embed again when nothing relevant changed', async () => {
    const doc = await newDoc();
    await indexing.index(repo(), doc);
    await indexing.index(repo(), (await repo().findById(doc.id))!);
    expect(embedder.calls).toHaveLength(1);
  });

  it('embeds again when the text changes, and replaces the old chunks', async () => {
    const doc = await newDoc();
    await indexing.index(repo(), doc);
    const edited = (await repo().update(doc.id, { content: 'Completely new text.' }))!;
    await indexing.index(repo(), edited);
    expect(embedder.calls).toHaveLength(2);
    expect(db.chunks.map((c) => c.content)).toEqual(['Completely new text.']);
  });

  it('embeds again when the title changes (it is part of the embedded text)', async () => {
    const doc = await newDoc();
    await indexing.index(repo(), doc);
    await indexing.index(repo(), (await repo().update(doc.id, { title: 'Renamed' }))!);
    expect(embedder.calls).toHaveLength(2);
  });

  it('embeds again after the embedding model changes', async () => {
    const doc = await newDoc();
    await indexing.index(repo(), doc);
    embedder.model = 'fake/embed-v2';
    await indexing.index(repo(), (await repo().findById(doc.id))!);
    expect(embedder.calls).toHaveLength(2);
    expect(db.chunks[0].embeddingModel).toBe('fake/embed-v2');
  });

  it('can be forced', async () => {
    const doc = await newDoc();
    await indexing.index(repo(), doc);
    await indexing.index(repo(), (await repo().findById(doc.id))!, { force: true });
    expect(embedder.calls).toHaveLength(2);
  });

  it('keeps the document and records the reason when the provider fails', async () => {
    const doc = await newDoc();
    embedder.failWith = new AiProviderError('unavailable', 'embeddings request failed (HTTP 503)', 503);
    await expect(indexing.index(repo(), doc)).resolves.toBe('failed');
    const stored = await repo().findById(doc.id);
    expect(stored).toMatchObject({ indexingStatus: 'failed' });
    expect(stored?.indexingError).toContain('HTTP 503');
    expect(db.chunks).toHaveLength(0);
  });

  it('recovers: a failed document is indexed by the next attempt', async () => {
    const doc = await newDoc();
    embedder.failWith = new AiProviderError('rate_limited', 'slow down', 429);
    await indexing.index(repo(), doc);
    embedder.failWith = undefined;
    await expect(indexing.index(repo(), (await repo().findById(doc.id))!)).resolves.toBe('indexed');
    expect((await repo().findById(doc.id))?.indexingStatus).toBe('indexed');
  });

  it('keeps the old chunks searchable when re-indexing fails halfway', async () => {
    const doc = await newDoc();
    await indexing.index(repo(), doc);
    const edited = (await repo().update(doc.id, { content: 'New text.' }))!;
    db.failNextChunkWrite = new Error('connection lost');
    await indexing.index(repo(), edited);
    expect(db.chunks.map((c) => c.content)).toEqual([doc.content]); // untouched
    expect((await repo().findById(doc.id))?.indexingStatus).toBe('failed');
  });

  it('never reveals secrets or internals in the stored error', async () => {
    const doc = await newDoc();
    embedder.failWith = new Error('Authorization: Bearer sk-secret at /home/app/node_modules/x.js');
    await indexing.index(repo(), doc);
    const stored = await repo().findById(doc.id);
    expect(stored?.indexingError).toBe('indexing failed unexpectedly');
  });

  it('embeds many chunks of a long document in one call', async () => {
    const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}. ${'word '.repeat(60)}`).join('\n\n');
    const doc = await newDoc(long);
    await indexing.index(repo(), doc);
    expect(embedder.calls).toHaveLength(1);
    expect(embedder.calls[0].length).toBe(db.chunks.length);
    expect(db.chunks.length).toBeGreaterThan(5);
    expect(embedder.calls[0].every((t) => t.startsWith('Guide\n\n'))).toBe(true);
  });
});
