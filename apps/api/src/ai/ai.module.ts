import { Global, Module } from '@nestjs/common';
import { type AiConfig, loadAiConfig } from '../config/ai-config.js';
import { CHAT_MODEL, EMBEDDING_MODEL } from './ai.types.js';
import { createChatModel, createEmbeddingModel } from './openai-compatible.js';

const AI_CONFIG = Symbol('AI_CONFIG');

/**
 * Provides the two AI ports. The provider is chosen purely by environment variables;
 * invalid configuration stops the application at startup, not at the first request.
 */
@Global()
@Module({
  providers: [
    { provide: AI_CONFIG, useFactory: (): AiConfig => loadAiConfig(process.env) },
    {
      provide: CHAT_MODEL,
      inject: [AI_CONFIG],
      useFactory: (config: AiConfig) => createChatModel(config.chat),
    },
    {
      provide: EMBEDDING_MODEL,
      inject: [AI_CONFIG],
      useFactory: (config: AiConfig) => createEmbeddingModel(config.embeddings),
    },
  ],
  exports: [CHAT_MODEL, EMBEDDING_MODEL],
})
export class AiModule {}
