import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// why: OAuth state is a short-lived signed payload carried through the Google redirect.
// We never trust the redirected value blindly; the HMAC over (userId|tenantId|nonce|expiry)
// is verified before any DB write happens. JWT would be overkill — state is a 1-min token.

export type StatePayload = {
  userId: string;
  tenantId: string;
  nonce: string;
  expiresAt: number;
};

const STATE_TTL_MS = 5 * 60 * 1000;

export function buildState(args: { userId: string; tenantId: string; secret: string }): string {
  const payload: StatePayload = {
    userId: args.userId,
    tenantId: args.tenantId,
    nonce: randomBytes(8).toString('base64url'),
    expiresAt: Date.now() + STATE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = createHmac('sha256', args.secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyState(args: { state: string; secret: string }): StatePayload | null {
  const parts = args.state.split('.');
  if (parts.length !== 2) return null;
  const [body, mac] = parts as [string, string];
  const expected = createHmac('sha256', args.secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  let parsed: StatePayload;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
  } catch {
    return null;
  }
  if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt < Date.now()) return null;
  return parsed;
}
