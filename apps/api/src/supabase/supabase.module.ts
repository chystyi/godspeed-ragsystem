import { Global, Module } from '@nestjs/common';
import { loadSupabaseConfig, SUPABASE_CONFIG } from './supabase.config.js';

@Global()
@Module({
  providers: [{ provide: SUPABASE_CONFIG, useFactory: () => loadSupabaseConfig(process.env) }],
  exports: [SUPABASE_CONFIG],
})
export class SupabaseModule {}
