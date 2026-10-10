import { describe, expect, it } from 'vitest';
import { ConcurrencyLimiter, RateLimitedError, SlidingWindowLimiter } from './rate-limiter.js';

function limiter(limit = 3, windowMs = 60000) {
  const time = { now: 1_000_000 };
  return { time, limiter: new SlidingWindowLimiter(limit, windowMs, () => time.now) };
}

describe('SlidingWindowLimiter', () => {
  it('allows up to the limit and then refuses with the time to wait', () => {
    const { time, limiter: l } = limiter();
    expect(l.check('a').allowed).toBe(true);
    time.now += 10_000;
    expect(l.check('a').allowed).toBe(true);
    time.now += 10_000;
    expect(l.check('a').allowed).toBe(true);
    time.now += 10_000;
    const refused = l.check('a');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(30); // the first request leaves the window in 30 s
  });

  it('lets requests through again as old ones leave the window', () => {
    const { time, limiter: l } = limiter();
    for (let i = 0; i < 3; i++) l.check('a');
    expect(l.check('a').allowed).toBe(false);
    time.now += 60_000;
    expect(l.check('a').allowed).toBe(true);
  });

  it('counts users separately', () => {
    const { limiter: l } = limiter();
    for (let i = 0; i < 3; i++) l.check('a');
    expect(l.check('a').allowed).toBe(false);
    expect(l.check('b').allowed).toBe(true);
  });

  it('does not count refused requests, so waiting really helps', () => {
    const { time, limiter: l } = limiter();
    for (let i = 0; i < 3; i++) l.check('a');
    for (let i = 0; i < 50; i++) l.check('a'); // hammering while blocked
    time.now += 60_000;
    expect(l.check('a').allowed).toBe(true);
  });

  it('forgets idle users so memory does not grow without bound', () => {
    const { time, limiter: l } = limiter();
    for (let i = 0; i < 2000; i++) l.check(`user-${i}`);
    time.now += 120_000;
    l.check('someone');
    expect(l.trackedKeys()).toBeLessThan(5);
  });
});

describe('SlidingWindowLimiter.enforce', () => {
  it('counts a request, and throws RateLimitedError with the wait once the limit is reached', () => {
    const { time, limiter: l } = limiter(2);
    l.enforce('a');
    time.now += 5_000;
    l.enforce('a');
    let error: unknown;
    try {
      l.enforce('a');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBe(55);
  });
});

describe('ConcurrencyLimiter', () => {
  it('hands out up to the limit and then none', () => {
    const l = new ConcurrencyLimiter(2);
    expect(l.acquire('a')).not.toBeNull();
    expect(l.acquire('a')).not.toBeNull();
    expect(l.acquire('a')).toBeNull();
    expect(l.active('a')).toBe(2);
  });

  it('frees a slot when it is released, and releasing twice frees only one', () => {
    const l = new ConcurrencyLimiter(1);
    const release = l.acquire('a')!;
    release();
    release();
    expect(l.active('a')).toBe(0);
    const again = l.acquire('a');
    expect(again).not.toBeNull();
    expect(l.acquire('a')).toBeNull(); // the double release did not hand out a second slot
  });

  it('counts users separately and forgets idle ones', () => {
    const l = new ConcurrencyLimiter(1);
    const a = l.acquire('a')!;
    expect(l.acquire('b')).not.toBeNull();
    a();
    expect(l.active('a')).toBe(0);
  });

  it('require throws RateLimitedError when full', () => {
    const l = new ConcurrencyLimiter(1);
    l.require('a');
    expect(() => l.require('a')).toThrow(RateLimitedError);
  });
});
