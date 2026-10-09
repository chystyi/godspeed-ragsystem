import { Module } from '@nestjs/common';
import { AiModule } from './ai/ai.module.js';
import { AppController } from './app.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { SupabaseModule } from './supabase/supabase.module.js';

@Module({
  imports: [AiModule, SupabaseModule, AuthModule, DocumentsModule],
  controllers: [AppController],
})
export class AppModule {}
