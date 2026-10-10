import { Logger } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from '../supabase/supabase.config.js';
import type { AuthUser, TokenVerifier } from './auth.types.js';

interface Jwk {
  kty?: string;
  kid?: string;
  alg?: string;
  [property: string]: unknown;
}

interface VerifierOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

/** Public signing keys change rarely; ten minutes keeps us current without constant fetching. */
const KEY_CACHE_MS = 10 * 60_000;
/** A token with an unknown key id may mean a rotated key, but must not trigger a fetch each time. */
const UNKNOWN_KEY_REFRESH_MS = 60_000;
const KEY_FETCH_TIMEOUT_MS = 5_000;
const MAX_TOKEN_CHARS = 8_192;

/** Algorithms of the asymmetric signing keys Supabase issues. */
const ALGORITHM_BY_KEY_TYPE: Record<string, string> = { EC: 'ES256', RSA: 'RS256' };

function decodeHeader(token: string): { alg: string; kid?: string } | null {
  if (token.length === 0 || token.length > MAX_TOKEN_CHARS) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header: unknown = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (typeof header !== 'object' || header === null || Array.isArray(header)) return null;
    const { alg, kid } = header as { alg?: unknown; kid?: unknown };
    if (typeof alg !== 'string') return null;
    return { alg, kid: typeof kid === 'string' ? kid : undefined };
  } catch {
    return null;
  }
}

/**
 * Verifies a Supabase access token. The project's public signing keys are cached here, and a
 * token's header is checked against them first, so a forged token costs no request to the
 * auth server (the library would otherwise fetch keys, or ask the server, on every attempt).
 */
export class SupabaseTokenVerifier implements TokenVerifier {
  private readonly logger = new Logger(SupabaseTokenVerifier.name);
  private readonly client: SupabaseClient;
  private readonly fetchKeys: typeof fetch;
  private readonly now: () => number;
  private keys: Jwk[] | null = null;
  private keysFetchedAt = 0;
  private lastUnknownKeyRefresh = Number.NEGATIVE_INFINITY;
  private lastFailedFetch = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly config: SupabaseConfig,
    options: VerifierOptions = {},
  ) {
    this.client = createClient(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.fetchKeys = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async verify(token: string): Promise<AuthUser | null> {
    const header = decodeHeader(token);
    if (!header) return null;
    try {
      await this.ensureKeys();
      // No asymmetric keys known (a project that still signs with a shared secret, or the key
      // endpoint is unreachable): let the library verify, as it always did.
      if (!this.keys || this.keys.length === 0) return this.claimsOf(token, await this.client.auth.getClaims(token));

      const key = await this.keyFor(header);
      if (!key) return null;
      const jwks = { keys: this.keys };
      return this.claimsOf(token, await this.client.auth.getClaims(token, { jwks } as never));
    } catch (error) {
      // Malformed or hostile tokens make the library throw (not only return an error); that is
      // a rejected token, not a server fault.
      this.logger.debug(`token verification threw: ${error instanceof Error ? error.name : 'unknown'}`);
      return null;
    }
  }

  private claimsOf(
    token: string,
    answer: { data: { claims?: { sub?: string } } | null; error: unknown },
  ): AuthUser | null {
    const subject = answer.data?.claims?.sub;
    if (answer.error || !subject) return null;
    return { id: subject, token };
  }

  /** The key a token claims to be signed with, if we know it and the algorithm matches it. */
  private async keyFor(header: { alg: string; kid?: string }): Promise<Jwk | null> {
    if (!header.kid) return null;
    let key = this.keys?.find((candidate) => candidate.kid === header.kid);
    if (!key && this.now() - this.lastUnknownKeyRefresh >= UNKNOWN_KEY_REFRESH_MS) {
      this.lastUnknownKeyRefresh = this.now();
      await this.loadKeys();
      key = this.keys?.find((candidate) => candidate.kid === header.kid);
    }
    if (!key) return null;
    const expected = key.alg ?? ALGORITHM_BY_KEY_TYPE[key.kty ?? ''];
    return expected === header.alg ? key : null;
  }

  private async ensureKeys(): Promise<void> {
    const fresh = this.keys !== null && this.now() - this.keysFetchedAt < KEY_CACHE_MS;
    if (fresh) return;
    // After a failure, wait a minute before trying again instead of fetching on every request.
    if (this.now() - this.lastFailedFetch < UNKNOWN_KEY_REFRESH_MS) return;
    await this.loadKeys();
  }

  private async loadKeys(): Promise<void> {
    try {
      const response = await this.fetchKeys(`${this.config.url}/auth/v1/.well-known/jwks.json`, {
        signal: AbortSignal.timeout(KEY_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { keys?: unknown };
      if (!Array.isArray(body.keys)) throw new Error('unexpected key set');
      this.keys = body.keys.filter((key): key is Jwk => typeof key === 'object' && key !== null);
      this.keysFetchedAt = this.now();
    } catch (error) {
      this.lastFailedFetch = this.now();
      this.logger.warn(`could not load the signing keys: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
