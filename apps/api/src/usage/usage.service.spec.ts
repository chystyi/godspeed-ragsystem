import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import { InMemoryUsageDatabase } from '../../test/in-memory-usage.js';
import { UsageService } from './usage.service.js';

const alice = { id: 'alice', token: 'alice' };
const bob = { id: 'bob', token: 'bob' };
const event = (over = {}) => ({ kind: 'chat' as const, model: 'm/one', promptTokens: 100, completionTokens: 20, ...over });

beforeAll(() => Logger.overrideLogger(false));

describe('UsageService', () => {
  it('adds up what a user used per day, kind and model', async () => {
    const db = new InMemoryUsageDatabase();
    const service = new UsageService(db.factory());
    await service.record(alice, event());
    await service.record(alice, event({ promptTokens: 50, completionTokens: 5 }));
    await service.record(alice, event({ kind: 'embedding', model: 'e/one', promptTokens: 300, completionTokens: 0 }));
    expect(await service.summary(alice, 30)).toEqual([
      { day: '2026-10-13', kind: 'chat', model: 'm/one', requests: 2, promptTokens: 150, completionTokens: 25 },
      { day: '2026-10-13', kind: 'embedding', model: 'e/one', requests: 1, promptTokens: 300, completionTokens: 0 },
    ]);
  });

  it("never shows one user another one's usage", async () => {
    const db = new InMemoryUsageDatabase();
    const service = new UsageService(db.factory());
    await service.record(alice, event());
    expect(await service.summary(bob, 30)).toEqual([]);
  });

  it('only counts the requested number of days', async () => {
    const db = new InMemoryUsageDatabase();
    const service = new UsageService(db.factory());
    db.today = '2026-09-01';
    await service.record(alice, event());
    db.today = '2026-10-13';
    await service.record(alice, event());
    expect((await service.summary(alice, 30)).map((r) => r.day)).toEqual(['2026-10-13']);
    expect((await service.summary(alice, 60)).map((r) => r.day)).toEqual(['2026-09-01', '2026-10-13']);
  });

  it('does not fail the request it belongs to when recording does not work', async () => {
    const db = new InMemoryUsageDatabase();
    db.failWith = new Error('database is down');
    await expect(new UsageService(db.factory()).record(alice, event())).resolves.toBeUndefined();
  });

  it('ignores events that are not real numbers', async () => {
    const db = new InMemoryUsageDatabase();
    const service = new UsageService(db.factory());
    await service.record(alice, event({ promptTokens: Number.NaN }));
    await service.record(alice, event({ completionTokens: -5 }));
    await service.record(alice, event({ promptTokens: 0, completionTokens: 0 })); // nothing to count
    expect(await service.summary(alice, 30)).toEqual([]);
  });
});
