import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';

const ALG = 'HS256';
const TTL_SEC = 15 * 60;

export type MagicClaims = { userId: string; jti: string; expSec: number };

function secretBytes(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signMagicLink(userId: string, secret: string): Promise<MagicClaims & { token: string }> {
  const jti = randomBytes(16).toString('base64url');
  const issuedAt = Math.floor(Date.now() / 1000);
  const expSec = issuedAt + TTL_SEC;
  const token = await new SignJWT({ type: 'magic' })
    .setProtectedHeader({ alg: ALG })
    .setSubject(userId)
    .setJti(jti)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expSec)
    .sign(secretBytes(secret));
  return { userId, jti, expSec, token };
}

export type MagicVerifyResult =
  | { ok: true; userId: string; jti: string }
  | { ok: false; reason: 'expired' | 'invalid' };

export async function verifyMagicLink(token: string, secret: string): Promise<MagicVerifyResult> {
  try {
    const { payload } = await jwtVerify(token, secretBytes(secret), { algorithms: [ALG] });
    if (payload.type !== 'magic' || typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, userId: payload.sub, jti: payload.jti };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid' };
  }
}

export const MAGIC_TTL_SEC = TTL_SEC;
