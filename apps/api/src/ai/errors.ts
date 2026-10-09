export type AiErrorKind =
  | 'authentication'
  | 'rate_limited'
  | 'unavailable'
  | 'bad_request'
  | 'invalid_response'
  | 'dimension_mismatch';

/**
 * Every failure of the AI provider, normalised so callers never depend on SDK types.
 * Messages never contain request headers, so the API key cannot leak through them.
 */
export class AiProviderError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AiProviderError';
  }
}
