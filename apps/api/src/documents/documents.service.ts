import type { KbDocument, KbDocumentSummary } from '@kb/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import {
  DOCUMENTS_REPOSITORY_FACTORY,
  type DocumentRecord,
  type DocumentsRepository,
  type DocumentsRepositoryFactory,
} from './documents.repository.js';
import type { CreateDocumentDto, UpdateDocumentDto } from './documents.schemas.js';
import { DocumentNotFoundError } from './errors.js';
import { IndexingService } from './indexing.service.js';

function toDocument({ contentHash: _hash, ...document }: DocumentRecord): KbDocument {
  return document;
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DOCUMENTS_REPOSITORY_FACTORY) private readonly repositories: DocumentsRepositoryFactory,
    private readonly indexing: IndexingService,
  ) {}

  async create(user: AuthUser, input: CreateDocumentDto): Promise<KbDocument> {
    const repository = this.repositories.forUser(user.token);
    const created = await repository.create(input);
    return this.indexAndReload(repository, created);
  }

  list(user: AuthUser): Promise<KbDocumentSummary[]> {
    return this.repositories.forUser(user.token).list();
  }

  async get(user: AuthUser, id: string): Promise<KbDocument> {
    const found = await this.repositories.forUser(user.token).findById(id);
    if (!found) throw new DocumentNotFoundError(id);
    return toDocument(found);
  }

  async update(user: AuthUser, id: string, patch: UpdateDocumentDto): Promise<KbDocument> {
    const repository = this.repositories.forUser(user.token);
    const updated = await repository.update(id, patch);
    if (!updated) throw new DocumentNotFoundError(id);
    // Unchanged title/text/model make this a no-op (tags are not embedded).
    return this.indexAndReload(repository, updated);
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    if (!(await this.repositories.forUser(user.token).delete(id))) throw new DocumentNotFoundError(id);
  }

  /** Retry indexing, e.g. after the AI provider was down or the embedding model changed. */
  async reindex(user: AuthUser, id: string): Promise<KbDocument> {
    const repository = this.repositories.forUser(user.token);
    const found = await repository.findById(id);
    if (!found) throw new DocumentNotFoundError(id);
    return this.indexAndReload(repository, found, { force: true });
  }

  /** Indexing problems never fail the request: the result shows the document's status. */
  private async indexAndReload(
    repository: DocumentsRepository,
    document: DocumentRecord,
    options: { force?: boolean } = {},
  ): Promise<KbDocument> {
    await this.indexing.index(repository, document, options);
    return toDocument((await repository.findById(document.id)) ?? document);
  }
}
