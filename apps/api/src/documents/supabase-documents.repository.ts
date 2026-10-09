import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from '../supabase/supabase.config.js';
import type {
  DocumentListItem,
  DocumentPatch,
  DocumentRecord,
  DocumentsRepository,
  DocumentsRepositoryFactory,
  NewDocument,
  ReplaceChunksArgs,
} from './documents.repository.js';
import { DocumentNotFoundError } from './errors.js';

const COLUMNS =
  'id, title, content, tags, indexing_status, indexing_error, indexed_at, content_hash, created_at, updated_at';
const LIST_COLUMNS =
  'id, title, tags, preview, indexing_status, indexing_error, indexed_at, created_at, updated_at';
/** Safety net for the list endpoint; real pagination is a documented follow-up. */
const LIST_LIMIT = 200;

interface DocumentRow {
  id: string;
  title: string;
  content: string;
  tags: string[];
  indexing_status: DocumentRecord['indexingStatus'];
  indexing_error: string | null;
  indexed_at: string | null;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
}

type ListRow = Omit<DocumentRow, 'content' | 'content_hash'> & { preview: string };

function toRecord(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tags: row.tags,
    indexingStatus: row.indexing_status,
    indexingError: row.indexing_error,
    indexedAt: row.indexed_at,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toListItem(row: ListRow): DocumentListItem {
  return {
    id: row.id,
    title: row.title,
    tags: row.tags,
    preview: row.preview,
    indexingStatus: row.indexing_status,
    indexingError: row.indexing_error,
    indexedAt: row.indexed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fail(operation: string, error: PostgrestError): never {
  throw new Error(`${operation} failed: ${error.message} (${error.code})`);
}

/**
 * Talks to Supabase with the USER'S token. Row level security therefore limits every query
 * to the user's own rows; there is deliberately no `user_id` filter in this file.
 */
class SupabaseDocumentsRepository implements DocumentsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(input: NewDocument): Promise<DocumentRecord> {
    const { data, error } = await this.client.from('documents').insert(input).select(COLUMNS).single();
    if (error) fail('creating the document', error);
    return toRecord(data as unknown as DocumentRow);
  }

  async findById(id: string): Promise<DocumentRecord | null> {
    const { data, error } = await this.client.from('documents').select(COLUMNS).eq('id', id).maybeSingle();
    if (error) fail('loading the document', error);
    return data ? toRecord(data as unknown as DocumentRow) : null;
  }

  async list(): Promise<DocumentListItem[]> {
    const { data, error } = await this.client
      .from('documents')
      .select(LIST_COLUMNS)
      .order('updated_at', { ascending: false })
      .limit(LIST_LIMIT);
    if (error) fail('listing documents', error);
    return (data as unknown as ListRow[]).map(toListItem);
  }

  async update(id: string, patch: DocumentPatch): Promise<DocumentRecord | null> {
    const { data, error } = await this.client.from('documents').update(patch).eq('id', id).select(COLUMNS);
    if (error) fail('updating the document', error);
    const [row] = data as unknown as DocumentRow[];
    return row ? toRecord(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    const { data, error } = await this.client.from('documents').delete().eq('id', id).select('id');
    if (error) fail('deleting the document', error);
    return data.length > 0;
  }

  async replaceChunks(id: string, args: ReplaceChunksArgs): Promise<void> {
    const { error } = await this.client.rpc('replace_document_chunks', {
      p_document_id: id,
      p_embedding_model: args.embeddingModel,
      p_content_hash: args.contentHash,
      p_chunks: args.chunks.map((chunk) => ({
        index: chunk.index,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        embedding: chunk.embedding,
      })),
    });
    if (error?.code === 'P0002') throw new DocumentNotFoundError(id);
    if (error) fail('storing the chunks', error);
  }

  async markIndexingFailed(id: string, message: string): Promise<void> {
    const { error } = await this.client
      .from('documents')
      .update({ indexing_status: 'failed', indexing_error: message })
      .eq('id', id);
    if (error) fail('recording the indexing failure', error);
  }
}

export class SupabaseDocumentsRepositoryFactory implements DocumentsRepositoryFactory {
  constructor(private readonly config: SupabaseConfig) {}

  forUser(accessToken: string): DocumentsRepository {
    const client = createClient(this.config.url, this.config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    return new SupabaseDocumentsRepository(client);
  }
}
