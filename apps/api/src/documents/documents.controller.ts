import type { KbDocument, KbDocumentSummary } from '@kb/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import {
  type ConcurrencyLimiter,
  DOCUMENT_CONCURRENCY_LIMITER,
  DOCUMENT_WRITE_LIMITER,
  type SlidingWindowLimiter,
} from '../http/rate-limiter.js';
import { UuidPipe, ValidationFailedError, ZodPipe } from '../http/validation.js';
import { DocumentNotFoundError } from './errors.js';
import { type ExtractedText, extractText } from './text-extraction.js';

/** Largest upload read into memory. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
import {
  type CreateDocumentDto,
  createDocumentSchema,
  type UpdateDocumentDto,
  updateDocumentSchema,
} from './documents.schemas.js';
import { DocumentsService } from './documents.service.js';

const documentId = new UuidPipe((id) => new DocumentNotFoundError(id));

@Controller('api/documents')
@UseGuards(AuthGuard)
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    @Inject(DOCUMENT_WRITE_LIMITER) private readonly writes: SlidingWindowLimiter,
    @Inject(DOCUMENT_CONCURRENCY_LIMITER) private readonly running: ConcurrencyLimiter,
  ) {}

  /** Runs a write that embeds text while holding one of the user's few slots. */
  private async guarded<T>(user: AuthUser, work: () => Promise<T>): Promise<T> {
    this.writes.enforce(user.id); // after validation: invalid requests are free
    const release = this.running.require(user.id);
    try {
      return await work();
    } finally {
      release();
    }
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createDocumentSchema)) body: CreateDocumentDto,
  ): Promise<KbDocument> {
    return this.guarded(user, () => this.documents.create(user, body));
  }

  /**
   * Text of an uploaded .txt or .pdf file, for the person to review and save as a document.
   * Nothing is stored and no embedding is made here; saving goes through the normal create route.
   */
  @Post('extract')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, parts: 10 } }))
  extract(@CurrentUser() user: AuthUser, @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined): Promise<ExtractedText> {
    if (!file) throw new ValidationFailedError([{ path: 'file', message: 'Choose a file to upload.' }]);
    return this.guarded(user, () => extractText({ buffer: file.buffer, filename: file.originalname }));
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<KbDocumentSummary[]> {
    return this.documents.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', documentId) id: string): Promise<KbDocument> {
    return this.documents.get(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', documentId) id: string,
    @Body(new ZodPipe(updateDocumentSchema)) body: UpdateDocumentDto,
  ): Promise<KbDocument> {
    return this.guarded(user, () => this.documents.update(user, id, body));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', documentId) id: string): Promise<void> {
    return this.documents.remove(user, id);
  }

  @Post(':id/reindex')
  @HttpCode(200)
  reindex(@CurrentUser() user: AuthUser, @Param('id', documentId) id: string): Promise<KbDocument> {
    return this.guarded(user, () => this.documents.reindex(user, id));
  }
}
