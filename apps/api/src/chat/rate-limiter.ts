import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types.js';

export interface LimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Each question costs up to three paid model calls, so it is limited per user.
 * In-memory: with several API instances each one counts on its own (a shared store such as
 * Redis would be the next step).
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

export const RATE_LIMITER = Symbol('RATE_LIMITER');

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(RATE_LIMITER) private readonly limiter: SlidingWindowLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const user = http.getRequest<AuthenticatedRequest>().user;
    if (!user) throw new Error('RateLimitGuard must run after AuthGuard');
    const decision = this.limiter.check(user.id);
    if (!decision.allowed) {
      http.getResponse<Response>().setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new HttpException('too many questions, slow down', 429);
    }
    return true;
  }
}
