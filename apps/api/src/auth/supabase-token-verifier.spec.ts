import { createClient } from '@supabase/supabase-js';
import { Logger } from '@nestjs/common';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseTokenVerifier } from './supabase-token-verifier.js';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

const getClaims = vi.fn();
const KID = '55acb716-4de4-41f9-91a5-d56dcb14f2fe';
const KEY = { kty: 'EC', crv: 'P-256', kid: KID, alg: 'ES256' };

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (header: unknown, payload: unknown = { sub: 'user-1' }) => `${b64(header)}.${b64(payload)}.signature`;
const goodToken = () => jwt({ alg: 'ES256', kid: KID, typ: 'JWT' });

let jwksFetch: ReturnType<typeof vi.fn>;
let clock: { now: number };

function verifier(keys: object[] = [KEY]) {
  jwksFetch = vi.fn(async () => new Response(JSON.stringify({ keys }), { status: 200 }));
  return new SupabaseTokenVerifier(
    { url: 'https://example.supabase.co', anonKey: 'anon-key' },
    { fetch: jwksFetch as unknown as typeof fetch, now: () => clock.now },
  );
}

beforeAll(() => Logger.overrideLogger(false));
beforeEach(() => {
  clock = { now: 1_000_000 };
  getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: 'user-1' } }, error: null });
  vi.mocked(createClient).mockReset();
  vi.mocked(createClient).mockReturnValue({ auth: { getClaims } } as never);
});

describe('SupabaseTokenVerifier', () => {
  it('does not keep a session of its own', () => {
    verifier();
    expect(createClient).toHaveBeenCalledWith('https://example.supabase.co', 'anon-key', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it('accepts a verified token and returns the user with their token', async () => {
    const token = goodToken();
    expect(await verifier().verify(token)).toEqual({ id: 'user-1', token });
  });

  it('verifies against the cached public keys instead of letting the library fetch them', async () => {
    const v = verifier();
    const token = goodToken();
    await v.verify(token);
    expect(getClaims).toHaveBeenCalledExactlyOnceWith(token, { jwks: { keys: [KEY] } });
  });

  it('fetches the public keys once for any number of requests', async () => {
    const v = verifier();
    for (let i = 0; i < 50; i++) await v.verify(goodToken());
    expect(jwksFetch).toHaveBeenCalledTimes(1);
    expect(jwksFetch).toHaveBeenCalledWith('https://example.supabase.co/auth/v1/.well-known/jwks.json', expect.anything());
  });

  it('refetches the keys after the cache expires', async () => {
    const v = verifier();
    await v.verify(goodToken());
    clock.now += 11 * 60_000;
    await v.verify(goodToken());
    expect(jwksFetch).toHaveBeenCalledTimes(2);
  });

  describe('forged tokens cost no outbound request beyond a rate-limited key refresh', () => {
    it('rejects an unknown key id without asking the auth server', async () => {
      const v = verifier();
      await v.verify(goodToken()); // warm the cache
      jwksFetch.mockClear();
      for (let i = 0; i < 100; i++) {
        expect(await v.verify(jwt({ alg: 'ES256', kid: `forged-${i}` }))).toBeNull();
      }
      expect(getClaims).toHaveBeenCalledTimes(1); // only the genuine token
      expect(jwksFetch.mock.calls.length).toBeLessThanOrEqual(1); // one refresh attempt, not 100
    });

    it('allows another key refresh only after a minute', async () => {
      const v = verifier();
      await v.verify(goodToken());
      jwksFetch.mockClear();
      await v.verify(jwt({ alg: 'ES256', kid: 'unknown-a' }));
      await v.verify(jwt({ alg: 'ES256', kid: 'unknown-b' }));
      expect(jwksFetch).toHaveBeenCalledTimes(1);
      clock.now += 61_000;
      await v.verify(jwt({ alg: 'ES256', kid: 'unknown-c' }));
      expect(jwksFetch).toHaveBeenCalledTimes(2);
    });

    it('picks up a rotated key', async () => {
      const v = verifier();
      await v.verify(goodToken());
      clock.now += 61_000;
      const rotated = { ...KEY, kid: 'new-key' };
      jwksFetch.mockResolvedValue(new Response(JSON.stringify({ keys: [KEY, rotated] })));
      expect(await v.verify(jwt({ alg: 'ES256', kid: 'new-key' }))).toEqual({
        id: 'user-1',
        token: expect.any(String),
      });
    });

    it.each([
      ['an unsigned token', { alg: 'none' }],
      ['a symmetric algorithm on an asymmetric project', { alg: 'HS256', kid: KID }],
      ['a token without a key id', { alg: 'ES256' }],
      ['an algorithm that does not match the key type', { alg: 'RS256', kid: KID }],
    ])('rejects %s before any verification', async (_name, header) => {
      const v = verifier();
      await v.verify(goodToken());
      getClaims.mockClear();
      expect(await v.verify(jwt(header))).toBeNull();
      expect(getClaims).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['not a token at all', 'hello'],
    ['too few parts', 'aaa.bbb'],
    ['a header that is not base64', '!!!.bbb.ccc'],
    ['a header that is not JSON', `${Buffer.from('nope').toString('base64url')}.bbb.ccc`],
    ['a header that is an array', `${b64([1, 2])}.bbb.ccc`],
    ['a header without alg', `${b64({ kid: KID })}.bbb.ccc`],
    ['an empty string', ''],
    ['a very long string', 'a.'.repeat(50_000)],
  ])('rejects %s without crashing or calling out', async (_name, token) => {
    const v = verifier();
    expect(await v.verify(token)).toBeNull();
    expect(getClaims).not.toHaveBeenCalled();
  });

  it.each([
    ['an error from verification', { data: null, error: { message: 'invalid JWT' } }],
    ['a token without a subject', { data: { claims: {} }, error: null }],
    ['an empty answer', { data: null, error: null }],
  ])('rejects %s', async (_name, answer) => {
    getClaims.mockResolvedValue(answer);
    expect(await verifier().verify(goodToken())).toBeNull();
  });

  it('answers null (not an exception, hence 401 not 500) when verification throws', async () => {
    getClaims.mockRejectedValue(new Error('Invalid alg claim'));
    expect(await verifier().verify(goodToken())).toBeNull();
    getClaims.mockRejectedValue(new DOMException('Invalid JWK "kty"', 'DataError'));
    expect(await verifier().verify(goodToken())).toBeNull();
  });

  describe('when the public keys cannot be loaded', () => {
    it('falls back to the library for a project without asymmetric keys', async () => {
      const v = verifier([]);
      const token = jwt({ alg: 'HS256' });
      expect(await v.verify(token)).toEqual({ id: 'user-1', token });
      expect(getClaims).toHaveBeenCalledExactlyOnceWith(token);
    });

    it('falls back to the library when the key endpoint is unreachable and nothing is cached', async () => {
      const v = verifier();
      jwksFetch.mockRejectedValue(new Error('network down'));
      const token = goodToken();
      expect(await v.verify(token)).toEqual({ id: 'user-1', token });
      expect(getClaims).toHaveBeenCalledExactlyOnceWith(token);
    });

    it('keeps using the cached keys when a later refresh fails', async () => {
      const v = verifier();
      await v.verify(goodToken());
      clock.now += 11 * 60_000;
      jwksFetch.mockRejectedValue(new Error('network down'));
      expect(await v.verify(goodToken())).not.toBeNull();
      expect(getClaims).toHaveBeenLastCalledWith(expect.any(String), { jwks: { keys: [KEY] } });
    });
  });
});
