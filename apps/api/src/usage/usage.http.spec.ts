import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryUsageDatabase } from '../../test/in-memory-usage.js';
import { TOKEN_VERIFIER, type TokenVerifier } from '../auth/auth.types.js';
import { configureApp } from '../http/configure-app.js';
import { UsageController } from './usage.controller.js';
import { UsageService } from './usage.service.js';
import { USAGE_REPOSITORY_FACTORY } from './usage.types.js';

const verifier: TokenVerifier = {
  async verify(token) {
    return token.startsWith('token-') ? { id: token.slice(6), token: token.slice(6) } : null;
  },
};
const as = (user: string) => ({ Authorization: `Bearer token-${user}` });

let app: INestApplication;
let db: InMemoryUsageDatabase;
const get = (path: string, user: string | null = 'alice') => {
  const req = request(app.getHttpServer()).get(path);
  return user ? req.set(as(user)) : req;
};

beforeEach(async () => {
  db = new InMemoryUsageDatabase();
  const moduleRef = await Test.createTestingModule({
    controllers: [UsageController],
    providers: [
      UsageService,
      { provide: USAGE_REPOSITORY_FACTORY, useValue: db.factory() },
      { provide: TOKEN_VERIFIER, useValue: verifier },
    ],
  }).compile();
  app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureApp(app);
  await app.init();
});
afterEach(() => app.close());

const service = () => app.get(UsageService);

describe('GET /api/usage', () => {
  it('requires a signed-in user', async () => {
    expect((await get('/api/usage', null)).status).toBe(401);
  });

  it("returns the user's own usage of the last 30 days by default", async () => {
    await service().record({ id: 'alice', token: 'alice' }, { kind: 'chat', model: 'm/one', promptTokens: 10, completionTokens: 2 });
    await service().record({ id: 'bob', token: 'bob' }, { kind: 'chat', model: 'm/one', promptTokens: 999, completionTokens: 999 });
    const res = await get('/api/usage');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      days: 30,
      rows: [{ day: '2026-10-13', kind: 'chat', model: 'm/one', requests: 1, promptTokens: 10, completionTokens: 2 }],
    });
  });

  it('accepts a number of days between 1 and 90', async () => {
    expect((await get('/api/usage?days=7')).body.days).toBe(7);
    expect((await get('/api/usage?days=90')).status).toBe(200);
  });

  it.each(['0', '91', '-1', 'abc', '1.5', ''])('rejects days=%s with 422', async (days) => {
    const res = await get(`/api/usage?days=${days}`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('validation_error');
  });
});
