import { Module } from '@nestjs/common';
import { SUPABASE_CONFIG, type SupabaseConfig } from '../supabase/supabase.config.js';
import { DocumentsController } from './documents.controller.js';
import { DOCUMENTS_REPOSITORY_FACTORY } from './documents.repository.js';
import { DocumentsService } from './documents.service.js';
import { IndexingService } from './indexing.service.js';
import { SupabaseDocumentsRepositoryFactory } from './supabase-documents.repository.js';

@Module({
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    IndexingService,
    {
      provide: DOCUMENTS_REPOSITORY_FACTORY,
      inject: [SUPABASE_CONFIG],
      useFactory: (config: SupabaseConfig) => new SupabaseDocumentsRepositoryFactory(config),
    },
  ],
  exports: [DocumentsService, IndexingService, DOCUMENTS_REPOSITORY_FACTORY],
})
export class DocumentsModule {}
