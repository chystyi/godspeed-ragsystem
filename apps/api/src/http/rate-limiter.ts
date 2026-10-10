export interface LimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Thrown when a limit is hit; the exception filter answers 429 with a Retry-After header. */
export class RateLimitedError extends Error {
  constructor(
    readonly retryAfterSeconds: number,
    message = 'too many requests, slow down',
  ) {
    super(message);
    this.name = 'RateLimitedError';
  }
}

/**
 * Requests per user in a sliding window. Used for everything that costs money (questions,
 * and document writes that are embedded). In-memory: with several API instances each one
 * counts on its own (a shared store such as Redis would be the next step).
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): LimitDecision {
    const now = this.now();
    this.sweep(now);
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSeconds: Math.ceil((recent[0] + this.windowMs - now) / 1000) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Counts one request or throws RateLimitedError. Call it after the request was validated. */
  enforce(key: string): void {
    const decision = this.check(key);
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
  }

  trackedKeys(): number {
    return this.hits.size;
  }

  /** Drop users without recent activity, at most once per window. */
  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= now - this.windowMs)) this.hits.delete(key);
    }
  }
}

/** How many things one user may have running at the same time (e.g. open answer streams). */
export class ConcurrencyLimiter {
  private readonly running = new Map<string, number>();

  constructor(private readonly limit: number) {}

  /** A function that frees the slot (safe to call twice), or null when none is free. */
  acquire(key: string): (() => void) | null {
    const current = this.running.get(key) ?? 0;
    if (current >= this.limit) return null;
    this.running.set(key, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.running.get(key) ?? 1) - 1;
      if (left <= 0) this.running.delete(key);
      else this.running.set(key, left);
    };
  }

  /** Like acquire, but throws RateLimitedError instead of returning null. */
  require(key: string, retryAfterSeconds = 5): () => void {
    const release = this.acquire(key);
    if (!release) throw new RateLimitedError(retryAfterSeconds, 'too many answers at once, wait for one to finish');
    return release;
  }

  active(key: string): number {
    return this.running.get(key) ?? 0;
  }
}

export const CHAT_LIMITER = Symbol('CHAT_LIMITER');
export const STREAM_LIMITER = Symbol('STREAM_LIMITER');
export const DOCUMENT_WRITE_LIMITER = Symbol('DOCUMENT_WRITE_LIMITER');
