import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// why: AES-256-GCM. Ciphertext format on disk = "v1:" + base64url( iv(12) | tag(16) | ct ).
// Versioned prefix lets us rotate the algorithm without a destructive migration —
// future v2 reads the same row by inspecting the prefix.
const VERSION_PREFIX = 'v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class TokenEncryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenEncryptError';
  }
}

function loadKey(rawKey: string): Buffer {
  if (!rawKey || rawKey.length === 0) {
    throw new TokenEncryptError('GCAL_TOKEN_ENCRYPTION_KEY is not set');
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(rawKey, 'base64');
  } catch {
    throw new TokenEncryptError('GCAL_TOKEN_ENCRYPTION_KEY must be base64');
  }
  if (buf.length !== 32) {
    throw new TokenEncryptError(
      `GCAL_TOKEN_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length})`,
    );
  }
  return buf;
}

export function encryptToken(plaintext: string, rawKey: string): string {
  const key = loadKey(rawKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([iv, tag, ct]).toString('base64url');
  return `${VERSION_PREFIX}${blob}`;
}

export function decryptToken(ciphertext: string, rawKey: string): string {
  if (!ciphertext.startsWith(VERSION_PREFIX)) {
    throw new TokenEncryptError('ciphertext missing version prefix');
  }
  const key = loadKey(rawKey);
  const blob = Buffer.from(ciphertext.slice(VERSION_PREFIX.length), 'base64url');
  if (blob.length < IV_BYTES + TAG_BYTES + 1) {
    throw new TokenEncryptError('ciphertext too short');
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

// why: stable in-memory default for dev only. Production MUST set the env var. The
// constitution requires no secrets in code — this is the dev fallback in the same shape
// as `cookieSecret`'s 32-char `dev-only-not-secret-replace-in-prod-...` pattern.
export const DEV_FALLBACK_KEY = Buffer.alloc(32, 7).toString('base64');
