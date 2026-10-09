import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMBEDDING_MODEL, type EmbeddingModel } from '../ai/ai.types.js';
import { AiProviderError } from '../ai/errors.js';
import { chunkText } from './chunker.js';
import type { DocumentRecord, DocumentsRepository } from './documents.repository.js';

export type IndexingOutcome = 'indexed' | 'skipped' | 'failed';

/**
 * Turns a document into searchable chunks. It never throws for provider or database
 * problems: the document is already saved, so a failure is recorded on the document
 * (status `failed`) and can be retried, instead of losing the user's text.
 */
@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);

  constructor(@Inject(EMBEDDING_MODEL) private readonly embedder: EmbeddingModel) {}

  async index(
    repository: DocumentsRepository,
    document: DocumentRecord,
    options: { force?: boolean } = {},
  ): Promise<IndexingOutcome> {
    const hash = this.contentHash(document);
    if (!options.force && document.indexingStatus === 'indexed' && document.contentHash === hash) {
      return 'skipped';
    }
    try {
      const chunks = chunkText(document.content);
      // The title is embedded with every chunk: a chunk like "set it to 30 seconds" is
      // ambiguous alone, but understandable as part of "Router setup guide".
      const { vectors } = await this.embedder.embed(
        chunks.map((chunk) => `${document.title}\n\n${chunk.content}`),
      );
      await repository.replaceChunks(document.id, {
        embeddingModel: this.embedder.model,
        contentHash: hash,
        chunks: chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i] })),
      });
      return 'indexed';
    } catch (error) {
      const message = this.describe(error);
      this.logger.error(`indexing document ${document.id} failed: ${message}`, (error as Error)?.stack);
      try {
        await repository.markIndexingFailed(document.id, message);
      } catch (markError) {
        this.logger.error(`could not record the indexing failure: ${String(markError)}`);
      }
      return 'failed';
    }
  }

  /** Same text, same title, same embedding setup: nothing to redo. */
  private contentHash(document: DocumentRecord): string {
    return createHash('sha256')
      .update(
        JSON.stringify([document.title, document.content, this.embedder.model, this.embedder.dimensions]),
      )
      .digest('hex');
  }

  /** Stored on the document and shown to the user: provider messages are ours and safe,
   *  anything else (stack fragments, headers, paths) is replaced by a generic text. */
  private describe(error: unknown): string {
    return error instanceof AiProviderError ? error.message : 'indexing failed unexpectedly';
  }
}
