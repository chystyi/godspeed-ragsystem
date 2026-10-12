import type { AuthUser } from '../src/auth/auth.types.js';
import type { UsageEvent, UsageRecorder, UsageRepository, UsageRepositoryFactory, UsageRow } from '../src/usage/usage.types.js';

/** Collects usage events in a list; can be told to fail, to check that nothing depends on it. */
export class FakeUsageRecorder implements UsageRecorder {
  events: { user: string; event: UsageEvent }[] = [];
  failWith: Error | undefined;
  async record(user: AuthUser, event: UsageEvent): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.events.push({ user: user.id, event });
  }
  of(kind: UsageEvent['kind']) {
    return this.events.filter((e) => e.event.kind === kind).map((e) => e.event);
  }
}

/** Per-user rows with a clock the test controls. */
export class InMemoryUsageDatabase {
  rows = new Map<string, UsageRow[]>(); // by user
  today = '2026-10-13';
  failWith: Error | undefined;

  factory(): UsageRepositoryFactory {
    return {
      forUser: (token) => {
        const user = token;
        const rows = () => this.rows.get(user) ?? [];
        const repository: UsageRepository = {
          record: async (event) => {
            if (this.failWith) throw this.failWith;
            const list = rows();
            const row = list.find((r) => r.day === this.today && r.kind === event.kind && r.model === event.model);
            if (row) {
              row.requests += 1;
              row.promptTokens += event.promptTokens;
              row.completionTokens += event.completionTokens;
            } else {
              list.push({ day: this.today, kind: event.kind, model: event.model, requests: 1, promptTokens: event.promptTokens, completionTokens: event.completionTokens });
            }
            this.rows.set(user, list);
          },
          list: async (days) => {
            const since = new Date(Date.parse(this.today) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
            return rows().filter((r) => r.day >= since).sort((a, b) => a.day.localeCompare(b.day));
          },
        };
        return repository;
      },
    };
  }
}
