import { Global, Module } from '@nestjs/common';
import { SUPABASE_CONFIG, type SupabaseConfig } from '../supabase/supabase.config.js';
import { SupabaseUsageRepositoryFactory } from './supabase-usage.repository.js';
import { UsageController } from './usage.controller.js';
import { UsageService } from './usage.service.js';
import { USAGE_RECORDER, USAGE_REPOSITORY_FACTORY } from './usage.types.js';

/** Global: chat and documents record into it without importing each other. */
@Global()
@Module({
  controllers: [UsageController],
  providers: [
    UsageService,
    { provide: USAGE_RECORDER, useExisting: UsageService },
    {
      provide: USAGE_REPOSITORY_FACTORY,
      inject: [SUPABASE_CONFIG],
      useFactory: (config: SupabaseConfig) => new SupabaseUsageRepositoryFactory(config),
    },
  ],
  exports: [USAGE_RECORDER],
})
export class UsageModule {}
