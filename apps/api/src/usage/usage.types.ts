import type { AuthUser } from '../auth/auth.types.js';

export type UsageKind = 'chat' | 'embedding';

/** One call to the AI provider, as far as its cost is concerned. */
export interface UsageEvent {
  kind: UsageKind;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/** Tokens used on one day, for one kind and model. */
export interface UsageRow {
  day: string;
  kind: UsageKind;
  model: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
}

/** What the rest of the application sees: recording never fails the request it belongs to. */
export interface UsageRecorder {
  record(user: AuthUser, event: UsageEvent): Promise<void>;
}
export const USAGE_RECORDER = Symbol('USAGE_RECORDER');

export interface UsageRepository {
  record(event: UsageEvent): Promise<void>;
  /** Rows of the last `days` days (today included), oldest first. */
  list(days: number): Promise<UsageRow[]>;
}

export interface UsageRepositoryFactory {
  forUser(accessToken: string): UsageRepository;
}
export const USAGE_REPOSITORY_FACTORY = Symbol('USAGE_REPOSITORY_FACTORY');
