import { Test } from '@nestjs/testing';
import request from 'supertest';
import { expect, it } from 'vitest';
import { AppController } from './app.controller.js';

it('answers the liveness probe without any dependencies', async () => {
  const moduleRef = await Test.createTestingModule({ controllers: [AppController] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  const res = await request(app.getHttpServer()).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok' });
  await app.close();
});
