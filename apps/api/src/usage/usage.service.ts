import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import {
  USAGE_REPOSITORY_FACTORY,
  type UsageEvent,
  type UsageRecorder,
  type UsageRepositoryFactory,
  type UsageRow,
} from './usage.types.js';

const isCount = (value: number) => Number.isFinite(value) && value >= 0;

@Injectable()
export class UsageService implements UsageRecorder {
  private readonly logger = new Logger(UsageService.name);

  constructor(@Inject(USAGE_REPOSITORY_FACTORY) private readonly repositories: UsageRepositoryFactory) {}

  /**
   * Counts one provider call. Usage is bookkeeping: whatever goes wrong here is logged and
   * never makes the answer or the document it belongs to fail.
   */
  async record(user: AuthUser, event: UsageEvent): Promise<void> {
    if (!isCount(event.promptTokens) || !isCount(event.completionTokens)) return;
    if (event.promptTokens === 0 && event.completionTokens === 0) return; // nothing to count
    try {
      await this.repositories.forUser(user.token).record({
        ...event,
        promptTokens: Math.round(event.promptTokens),
        completionTokens: Math.round(event.completionTokens),
      });
    } catch (error) {
      this.logger.warn(`could not record usage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  summary(user: AuthUser, days: number): Promise<UsageRow[]> {
    return this.repositories.forUser(user.token).list(days);
  }
}
