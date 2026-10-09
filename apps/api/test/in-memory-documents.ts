import { randomUUID } from 'node:crypto';
import type {
  DocumentListItem,
  DocumentPatch,
  DocumentRecord,
  DocumentsRepository,
  DocumentsRepositoryFactory,
  NewDocument,
  ReplaceChunksArgs,
} from '../src/documents/documents.repository.js';
import { DocumentNotFoundError } from '../src/documents/errors.js';

interface StoredChunk {
  documentId: string;
  userId: string;
  index: number;
  content: string;
  embeddingModel: string;
  embedding: number[];
}

type StoredDocument = DocumentRecord & { userId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres rejects a malformed uuid with an error instead of finding nothing. */
function requireUuid(id: string): void {
  if (!UUID.test(id)) throw new Error(`invalid input syntax for type uuid: "${id}"`);
}

/** Behaves like the Supabase repository: a user sees only their own rows. */
class InMemoryRepository implements DocumentsRepository {
  constructor(
    private readonly db: InMemoryDatabase,
    private readonly userId: string,
  ) {}

  private own(): StoredDocument[] {
    return this.db.documents.filter((d) => d.userId === this.userId);
  }

  private tick(): string {
    return new Date(Date.UTC(2026, 9, 9, 12, 0, ++this.db.clock)).toISOString();
  }

  private static strip({ userId: _userId, ...record }: StoredDocument): DocumentRecord {
    return record;
  }

  async create(input: NewDocument): Promise<DocumentRecord> {
    const now = this.tick();
    const record: StoredDocument = {
      id: randomUUID(),
      userId: this.userId,
      title: input.title,
      content: input.content,
      tags: input.tags,
      indexingStatus: 'pending',
      indexingError: null,
      indexedAt: null,
      contentHash: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.documents.push(record);
    return InMemoryRepository.strip(record);
  }

  async findById(id: string): Promise<DocumentRecord | null> {
    requireUuid(id);
    const found = this.own().find((d) => d.id === id);
    return found ? InMemoryRepository.strip(found) : null;
  }

  async list(): Promise<DocumentListItem[]> {
    return this.own()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ content, contentHash: _h, userId: _u, ...rest }) => ({
        ...rest,
        preview: content.slice(0, 200),
      }));
  }

  async update(id: string, patch: DocumentPatch): Promise<DocumentRecord | null> {
    requireUuid(id);
    const found = this.own().find((d) => d.id === id);
    if (!found) return null;
    const changed =
      (patch.title !== undefined && patch.title !== found.title) ||
      (patch.content !== undefined && patch.content !== found.content) ||
      (patch.tags !== undefined && patch.tags.join() !== found.tags.join());
    Object.assign(found, patch);
    if (changed) found.updatedAt = this.tick();
    return InMemoryRepository.strip(found);
  }

  async delete(id: string): Promise<boolean> {
    requireUuid(id);
    const before = this.db.documents.length;
    this.db.documents = this.db.documents.filter((d) => !(d.id === id && d.userId === this.userId));
    this.db.chunks = this.db.chunks.filter((c) => c.documentId !== id || c.userId !== this.userId);
    return this.db.documents.length < before;
  }

  async replaceChunks(id: string, args: ReplaceChunksArgs): Promise<void> {
    requireUuid(id);
    if (this.db.failNextChunkWrite) {
      const error = this.db.failNextChunkWrite;
      this.db.failNextChunkWrite = undefined;
      throw error;
    }
    const doc = this.own().find((d) => d.id === id);
    if (!doc) throw new DocumentNotFoundError(id);
    this.db.chunks = this.db.chunks.filter((c) => c.documentId !== id);
    for (const chunk of args.chunks) {
      this.db.chunks.push({
        documentId: id,
        userId: this.userId,
        index: chunk.index,
        content: chunk.content,
        embeddingModel: args.embeddingModel,
        embedding: chunk.embedding,
      });
    }
    Object.assign(doc, {
      indexingStatus: 'indexed',
      indexingError: null,
      indexedAt: this.tick(),
      contentHash: args.contentHash,
    });
  }

  async markIndexingFailed(id: string, message: string): Promise<void> {
    const doc = this.own().find((d) => d.id === id);
    if (doc) Object.assign(doc, { indexingStatus: 'failed', indexingError: message });
  }
}

export class InMemoryDatabase {
  documents: StoredDocument[] = [];
  chunks: StoredChunk[] = [];
  clock = 0;
  /** Make the next replaceChunks call fail, to test recovery. */
  failNextChunkWrite: Error | undefined;

  repositoryFor(userId: string): DocumentsRepository {
    return new InMemoryRepository(this, userId);
  }

  factory(): DocumentsRepositoryFactory {
    // In tests the "token" is simply the user id.
    return { forUser: (token: string) => this.repositoryFor(token) };
  }
}
