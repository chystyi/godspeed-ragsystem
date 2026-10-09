import { describe, expect, it } from 'vitest';
import { loadAiConfig } from '../config/ai-config.js';
import { loadRootEnv } from '../config/load-env.js';
import { createChatModel, createEmbeddingModel } from './openai-compatible.js';

// Opt-in: talks to the real provider configured in .env (costs a fraction of a cent).
//   RUN_LIVE_AI=1 npm run test -w @kb/api -- ai.live
describe.skipIf(!process.env.RUN_LIVE_AI)('live provider', () => {
  loadRootEnv();
  const config = () => loadAiConfig(process.env);

  it('embeds texts with the configured dimensions', async () => {
    const model = createEmbeddingModel(config().embeddings);
    const { vectors, usage } = await model.embed(['The cat sat on the mat.', 'Stock markets fell.']);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(model.dimensions);
    expect(usage.totalTokens).toBeGreaterThan(0);
  }, 30000);

  it('answers a chat question', async () => {
    const model = createChatModel(config().chat);
    const answer = await model.complete(
      [{ role: 'user', content: 'Reply with exactly one word: pong' }],
      { maxTokens: 10, temperature: 0 },
    );
    // Model output is not deterministic: check the plumbing, not the wording.
    expect(answer.content.trim().length).toBeGreaterThan(0);
    expect(answer.model).toBeTruthy();
    expect(answer.usage?.totalTokens).toBeGreaterThan(0);
  }, 30000);
});
