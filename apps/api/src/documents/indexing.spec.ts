import { Logger } from '@nestjs/common';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** An embedder whose answers are held back until the test releases them, in any order. */
class GatedEmbedder extends FakeEmbedder {
  private gates: (() => void)[] = [];
  async embed(texts: string[]) {
    await new Promise<void>((resolve) => this.gates.push(resolve));
    return super.embed(texts);
  }
  /** Lets the n-th pending embedding finish. */
  release(index: number) {
    this.gates[index]();
  }
  get pending() {
    return this.gates.length;
  }
}

describe('IndexingService with overlapping edits', () => {
  async function twoOverlappingEdits(order: [number, number]) {
    const gated = new GatedEmbedder();
    const service = new IndexingService(gated);
    const doc = await newDoc('original text', 'Guide');
    const first = (await repo().update(doc.id, { content: 'OLD edit' }))!;
    const second = (await repo().update(doc.id, { content: 'NEW edit' }))!;
    const runs = [service.index(repo(), first), service.index(repo(), second)];
    await vi.waitFor(() => expect(gated.pending).toBe(2));
    const outcomes: string[] = [];
    for (const which of order) {
      gated.release(which);
      outcomes[which] = await runs[which];
    }
    return { outcomes, doc };
  }

  it.each([
    ['the older run finishes last', [1, 0]],
    ['the newer run finishes last', [0, 1]],
  ] as const)('keeps the newest text searchable when %s', async (_name, order) => {
    const { doc } = await twoOverlappingEdits([...order]);
    expect(db.chunks.map((c) => c.content)).toEqual(['NEW edit']);
    const stored = await repo().findById(doc.id);
    expect(stored).toMatchObject({ indexingStatus: 'indexed', content: 'NEW edit' });
  });

  it('drops the result about the older text instead of reporting a failure', async () => {
    const { outcomes } = await twoOverlappingEdits([1, 0]);
    expect(outcomes).toEqual(['skipped', 'indexed']); // run 0 (old) is dropped, run 1 (new) is stored
  });

  it('does not let a failure about older text mark the newer text as failed', async () => {
    const gated = new GatedEmbedder();
    const service = new IndexingService(gated);
    const doc = await newDoc('original', 'Guide');
    const oldVersion = (await repo().update(doc.id, { content: 'OLD edit' }))!;
    const oldRun = service.index(repo(), oldVersion);
    await vi.waitFor(() => expect(gated.pending).toBe(1));
    const newVersion = (await repo().update(doc.id, { content: 'NEW edit' }))!;
    gated.failWith = new AiProviderError('unavailable', 'down', 503); // the old run will fail...
    gated.release(0);
    await oldRun;
    // ...but the document now holds newer text, so its state must be untouched
    expect((await repo().findById(doc.id))?.indexingStatus).not.toBe('failed');
    // and the new text can still be indexed normally
    gated.failWith = undefined;
    const newRun = service.index(repo(), newVersion);
    await vi.waitFor(() => expect(gated.pending).toBe(2));
    gated.release(1);
    await expect(newRun).resolves.toBe('indexed');
  });
});

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
    expect(stored?.indexingError).toBe('the AI provider is unavailable');
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

  it.each([
    ['unavailable', 'the AI provider is unavailable'],
    ['rate_limited', 'the AI provider is busy'],
    ['authentication', 'the AI provider could not be used'],
    ['bad_request', 'the AI provider could not process this text'],
    ['invalid_response', 'the AI provider returned an unusable answer'],
    ['dimension_mismatch', 'the embedding model returns vectors of the wrong size'],
  ] as const)('stores a fixed explanation for a "%s" failure, never the provider\'s own text', async (kind, expected) => {
    const doc = await newDoc();
    embedder.failWith = new AiProviderError(kind, 'provider said: key sk-secret-123 and your text "private words"', 500);
    await indexing.index(repo(), doc);
    const stored = await repo().findById(doc.id);
    expect(stored?.indexingError).toBe(expected);
    expect(stored?.indexingError).not.toMatch(/sk-secret|private words/);
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
