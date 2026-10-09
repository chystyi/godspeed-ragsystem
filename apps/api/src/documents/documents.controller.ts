import type { KbDocument, KbDocumentSummary } from '@kb/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { DocumentIdPipe, ZodPipe } from '../http/validation.js';
import {
  type CreateDocumentDto,
  createDocumentSchema,
  type UpdateDocumentDto,
  updateDocumentSchema,
} from './documents.schemas.js';
import { DocumentsService } from './documents.service.js';

@Controller('api/documents')
@UseGuards(AuthGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createDocumentSchema)) body: CreateDocumentDto,
  ): Promise<KbDocument> {
    return this.documents.create(user, body);
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<KbDocumentSummary[]> {
    return this.documents.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', DocumentIdPipe) id: string): Promise<KbDocument> {
    return this.documents.get(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', DocumentIdPipe) id: string,
    @Body(new ZodPipe(updateDocumentSchema)) body: UpdateDocumentDto,
  ): Promise<KbDocument> {
    return this.documents.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', DocumentIdPipe) id: string): Promise<void> {
    return this.documents.remove(user, id);
  }

  @Post(':id/reindex')
  @HttpCode(200)
  reindex(@CurrentUser() user: AuthUser, @Param('id', DocumentIdPipe) id: string): Promise<KbDocument> {
    return this.documents.reindex(user, id);
  }
}
