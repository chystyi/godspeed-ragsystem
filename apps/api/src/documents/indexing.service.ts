import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMBEDDING_MODEL, type EmbeddingModel } from '../ai/ai.types.js';
import { type AiErrorKind, AiProviderError } from '../ai/errors.js';
import { chunkText } from './chunker.js';
import { documentDigest } from './digest.js';
import type { DocumentRecord, DocumentsRepository } from './documents.repository.js';
import { StaleIndexError } from './errors.js';

/**
 * What the owner of a document is told when indexing fails. Fixed texts per kind: the provider's
 * own message could echo the document text or other details, and is only written to the log.
 */
const EXPLANATION: Record<AiErrorKind, string> = {
  unavailable: 'the AI provider is unavailable',
  rate_limited: 'the AI provider is busy',
  authentication: 'the AI provider could not be used',
  bad_request: 'the AI provider could not process this text',
  invalid_response: 'the AI provider returned an unusable answer',
  dimension_mismatch: 'the embedding model returns vectors of the wrong size',
};

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
    const contentDigest = documentDigest(document.title, document.content);
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
        contentDigest,
        chunks: chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i] })),
      });
      return 'indexed';
    } catch (error) {
      if (error instanceof StaleIndexError) {
        // The text changed while we were embedding the old version. The edit that changed it
        // runs its own indexing, so this result is simply dropped.
        this.logger.log(`indexing result for document ${document.id} dropped: the document changed meanwhile`);
        return 'skipped';
      }
      const message = this.describe(error);
      this.logger.error(`indexing document ${document.id} failed: ${String((error as Error)?.message ?? error)}`, (error as Error)?.stack);
      try {
        await repository.markIndexingFailed(document.id, message, contentDigest);
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

  /** Stored on the document and shown to its owner: a fixed explanation, never provider text. */
  private describe(error: unknown): string {
    return error instanceof AiProviderError ? EXPLANATION[error.kind] : 'indexing failed unexpectedly';
  }
}
