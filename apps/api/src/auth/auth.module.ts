import { Global, Module } from '@nestjs/common';
import { SUPABASE_CONFIG, type SupabaseConfig } from '../supabase/supabase.config.js';
import { TOKEN_VERIFIER } from './auth.types.js';
import { SupabaseTokenVerifier } from './supabase-token-verifier.js';

@Global()
@Module({
  providers: [
    {
      provide: TOKEN_VERIFIER,
      inject: [SUPABASE_CONFIG],
      useFactory: (config: SupabaseConfig) => new SupabaseTokenVerifier(config),
    },
  ],
  exports: [TOKEN_VERIFIER],
})
export class AuthModule {}
