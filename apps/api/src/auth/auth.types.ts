export interface AuthUser {
  id: string;
  /** The user's own JWT. Database calls are made with it, so row level security applies. */
  token: string;
}

export interface TokenVerifier {
  /** Returns the user for a valid access token, or null. */
  verify(token: string): Promise<AuthUser | null>;
}

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
}
