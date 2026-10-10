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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { DOCUMENT_WRITE_LIMITER, type SlidingWindowLimiter } from '../http/rate-limiter.js';
import { UuidPipe, ZodPipe } from '../http/validation.js';
import { DocumentNotFoundError } from './errors.js';
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
  ) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createDocumentSchema)) body: CreateDocumentDto,
  ): Promise<KbDocument> {
    this.writes.enforce(user.id); // after validation: invalid requests are free
    return this.documents.create(user, body);
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
    this.writes.enforce(user.id);
    return this.documents.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', documentId) id: string): Promise<void> {
    return this.documents.remove(user, id);
  }

  @Post(':id/reindex')
  @HttpCode(200)
  reindex(@CurrentUser() user: AuthUser, @Param('id', documentId) id: string): Promise<KbDocument> {
    this.writes.enforce(user.id);
    return this.documents.reindex(user, id);
  }
}
