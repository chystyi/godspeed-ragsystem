/**
 * Ports of the AI layer. The rest of the application depends on these two interfaces only,
 * never on a provider SDK, so providers are swapped by configuration.
 *
 * Chat and embeddings are separate on purpose: they can point at different providers
 * (e.g. chat on OpenRouter, embeddings on a local Ollama).
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface ChatCompletion {
  content: string;
  model: string;
  usage?: TokenUsage;
}

export interface ChatModel {
  complete(messages: ChatTurn[], options?: ChatOptions): Promise<ChatCompletion>;
}

export interface EmbeddingResult {
  /** One vector per input text, in input order. */
  vectors: number[][];
  usage: { totalTokens: number };
}

export interface EmbeddingModel {
  /** Model name as sent to the provider; stored with every vector. */
  readonly model: string;
  /** Size of every returned vector; must match the vector column in the database. */
  readonly dimensions: number;
  embed(texts: string[]): Promise<EmbeddingResult>;
}

/** Injection tokens (NestJS). */
export const CHAT_MODEL = Symbol('CHAT_MODEL');
export const EMBEDDING_MODEL = Symbol('EMBEDDING_MODEL');
