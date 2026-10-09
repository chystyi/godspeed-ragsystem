import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from './rate-limiter.js';

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
