import { Module } from '@nestjs/common';
import { SUPABASE_CONFIG, type SupabaseConfig } from '../supabase/supabase.config.js';
import { CHAT_CONFIG, type ChatConfig, loadChatConfig } from './chat.config.js';
import { ChatController } from './chat.controller.js';
import { CHAT_REPOSITORY_FACTORY } from './chat.repository.js';
import { ChatService } from './chat.service.js';
import { RATE_LIMITER, RateLimitGuard, SlidingWindowLimiter } from './rate-limiter.js';
import { SupabaseChatRepositoryFactory } from './supabase-chat.repository.js';

@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    RateLimitGuard,
    { provide: CHAT_CONFIG, useFactory: () => loadChatConfig(process.env) },
    {
      provide: CHAT_REPOSITORY_FACTORY,
      inject: [SUPABASE_CONFIG],
      useFactory: (config: SupabaseConfig) => new SupabaseChatRepositoryFactory(config),
    },
    {
      provide: RATE_LIMITER,
      inject: [CHAT_CONFIG],
      useFactory: (config: ChatConfig) => new SlidingWindowLimiter(config.rateLimitPerMinute, 60_000),
    },
  ],
})
export class ChatModule {}
