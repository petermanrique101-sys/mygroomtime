import type { TwinState, TwinTokenGrant } from './state.js';

export function readBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/.exec(authHeader);
  return m ? (m[1] as string) : null;
}

export function findGrantByAccessToken(
  state: TwinState,
  token: string | null,
): TwinTokenGrant | null {
  if (!token) return null;
  const grant = state.tokensByAccess.get(token);
  if (!grant) return null;
  if (grant.expiresAt < Date.now()) return null;
  return grant;
}
