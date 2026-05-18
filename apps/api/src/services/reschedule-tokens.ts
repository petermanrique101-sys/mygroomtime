import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { SessionStore } from '../adapters/session/index.js';

const ALG = 'HS256';

// why: a customer who taps the reschedule link AFTER the appointment start time should
// still be able to use it (showed up late, schedule shifted, etc.). The 6h grace window
// covers normal real-world drift without leaving a stale link valid forever.
const GRACE_SEC = 6 * 60 * 60;
const MIN_TTL_SEC = 5 * 60;

export type RescheduleClaims = {
  appointmentId: string;
  tenantId: string;
  jti: string;
};

export type IssueInput = {
  appointmentId: string;
  tenantId: string;
  scheduledStart: Date;
  webOrigin: string;
  tenantSlug: string;
  secret: string;
  sessionStore: SessionStore;
  now?: Date;
};

function secretBytes(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

function buildPublicSubdomainUrl(webOrigin: string, slug: string, path: string): string {
  const parsed = new URL(webOrigin);
  return `${parsed.protocol}//${slug}.${parsed.host}${path}`;
}

export async function issueRescheduleToken(
  input: IssueInput,
): Promise<{ token: string; url: string; expSec: number; jti: string }> {
  const now = input.now ?? new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const startSec = Math.floor(input.scheduledStart.getTime() / 1000);
  const expSec = Math.max(nowSec + MIN_TTL_SEC, startSec + GRACE_SEC);
  const jti = randomBytes(16).toString('base64url');

  const token = await new SignJWT({
    type: 'reschedule',
    appointmentId: input.appointmentId,
    tenantId: input.tenantId,
  })
    .setProtectedHeader({ alg: ALG })
    .setJti(jti)
    .setIssuedAt(nowSec)
    .setExpirationTime(expSec)
    .sign(secretBytes(input.secret));

  await input.sessionStore.recordRescheduleJti(jti, expSec - nowSec);

  const url = buildPublicSubdomainUrl(
    input.webOrigin,
    input.tenantSlug,
    `/public/reschedule/${token}`,
  );
  return { token, url, expSec, jti };
}

export type VerifyResult =
  | { ok: true; claims: RescheduleClaims }
  | { ok: false; reason: 'expired' | 'invalid' };

export async function verifyRescheduleToken(
  token: string,
  secret: string,
): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, secretBytes(secret), { algorithms: [ALG] });
    if (
      payload.type !== 'reschedule' ||
      typeof payload.appointmentId !== 'string' ||
      typeof payload.tenantId !== 'string' ||
      typeof payload.jti !== 'string'
    ) {
      return { ok: false, reason: 'invalid' };
    }
    return {
      ok: true,
      claims: {
        appointmentId: payload.appointmentId,
        tenantId: payload.tenantId,
        jti: payload.jti,
      },
    };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid' };
  }
}

// why: single-use enforcement. The verify endpoint (GET-shaped) only checks the signature;
// the commit endpoint reads + consumes the jti from Redis. Returning false on consume means
// the token was already used and the caller should render the "already used" UX.
export async function consumeJti(
  sessionStore: SessionStore,
  jti: string,
): Promise<boolean> {
  return sessionStore.consumeRescheduleJti(jti);
}

export const RESCHEDULE_GRACE_SEC = GRACE_SEC;
