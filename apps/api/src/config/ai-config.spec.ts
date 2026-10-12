import { describe, expect, it } from 'vitest';
import { ConfigError, loadAiConfig } from './ai-config.js';

const base = {
  AI_BASE_URL: 'https://openrouter.ai/api/v1',
  AI_API_KEY: 'sk-secret-value',
  AI_CHAT_MODEL: 'openai/gpt-4o-mini',
  AI_EMBEDDING_MODEL: 'openai/text-embedding-3-small',
};

describe('loadAiConfig', () => {
  it('builds chat and embedding settings with defaults', () => {
    const config = loadAiConfig(base);
    expect(config.chat).toEqual({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-secret-value',
      model: 'openai/gpt-4o-mini',
      timeoutMs: 30000,
      maxRetries: 2,
    });
    expect(config.embeddings).toEqual({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-secret-value',
      model: 'openai/text-embedding-3-small',
      dimensions: 1536,
      sendDimensions: true,
      timeoutMs: 30000,
      maxRetries: 2,
    });
  });

  it('lets embeddings use a different provider than chat', () => {
    const config = loadAiConfig({
      ...base,
      AI_EMBEDDING_BASE_URL: 'http://localhost:11434/v1',
      AI_EMBEDDING_API_KEY: 'ollama',
      AI_EMBEDDING_DIMENSIONS: '768',
      AI_EMBEDDING_SEND_DIMENSIONS: 'false',
    });
    expect(config.chat.baseURL).toBe('https://openrouter.ai/api/v1');
    expect(config.embeddings).toMatchObject({
      baseURL: 'http://localhost:11434/v1',
      apiKey: 'ollama',
      dimensions: 768,
      sendDimensions: false,
    });
  });

  it('does not send the chat key to another embedding provider unless told to', () => {
    const error = catchError(() => loadAiConfig({ ...base, AI_EMBEDDING_BASE_URL: 'https://embeddings.example.com/v1' }));
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toContain('AI_EMBEDDING_API_KEY');
    expect((error as Error).message).not.toContain('sk-secret-value');
  });

  it('still shares the key when the embedding address is the same provider', () => {
    const config = loadAiConfig({ ...base, AI_EMBEDDING_BASE_URL: 'https://openrouter.ai/api/v1/' });
    expect(config.embeddings.apiKey).toBe('sk-secret-value');
  });

  it('names every missing or invalid variable, once', () => {
    const error = catchError(() => loadAiConfig({ AI_BASE_URL: 'not a url', AI_API_KEY: '' }));
    expect(error).toBeInstanceOf(ConfigError);
    for (const name of ['AI_BASE_URL', 'AI_API_KEY', 'AI_CHAT_MODEL', 'AI_EMBEDDING_MODEL']) {
      expect(error.message).toContain(name);
    }
  });

  it('never prints configured values in the error', () => {
    const error = catchError(() =>
      loadAiConfig({ ...base, AI_API_KEY: 'sk-secret-value', AI_EMBEDDING_DIMENSIONS: 'abc' }),
    );
    expect(error.message).toContain('AI_EMBEDDING_DIMENSIONS');
    expect(error.message).not.toContain('sk-secret-value');
    expect(error.message).not.toContain('abc');
  });

  it.each([
    ['AI_EMBEDDING_DIMENSIONS', '0'],
    ['AI_EMBEDDING_DIMENSIONS', '-5'],
    ['AI_MAX_RETRIES', '9'],
    ['AI_TIMEOUT_MS', '0'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => loadAiConfig({ ...base, [name]: value })).toThrow(ConfigError);
  });
});

function catchError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected an error');
}

describe('selectable chat models', () => {
  it('offers only the default model when no list is given', () => {
    expect(loadAiConfig(base).chatModels).toEqual(['openai/gpt-4o-mini']);
  });

  it('adds the listed models after the default, without duplicates or blanks', () => {
    const config = loadAiConfig({
      ...base,
      AI_CHAT_MODELS: ' anthropic/claude-sonnet , openai/gpt-4o-mini,,google/gemini-flash ',
    });
    expect(config.chatModels).toEqual(['openai/gpt-4o-mini', 'anthropic/claude-sonnet', 'google/gemini-flash']);
  });
});
