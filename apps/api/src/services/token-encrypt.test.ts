import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken, DEV_FALLBACK_KEY, TokenEncryptError } from './token-encrypt.js';

describe('token-encrypt', () => {
  it('round-trips a refresh token through AES-256-GCM', () => {
    const plain = 'twin_rt_42_super_secret_value';
    const ct = encryptToken(plain, DEV_FALLBACK_KEY);
    expect(ct.startsWith('v1:')).toBe(true);
    expect(ct).not.toContain(plain);
    expect(decryptToken(ct, DEV_FALLBACK_KEY)).toBe(plain);
  });

  it('emits a fresh IV per call (no deterministic ciphertext)', () => {
    const a = encryptToken('same-plain', DEV_FALLBACK_KEY);
    const b = encryptToken('same-plain', DEV_FALLBACK_KEY);
    expect(a).not.toBe(b);
  });

  it('rejects wrong key with GCM auth failure', () => {
    const ct = encryptToken('plain', DEV_FALLBACK_KEY);
    const wrongKey = Buffer.alloc(32, 9).toString('base64');
    expect(() => decryptToken(ct, wrongKey)).toThrow();
  });

  it('rejects key that does not decode to 32 bytes', () => {
    expect(() => encryptToken('plain', Buffer.alloc(16, 1).toString('base64'))).toThrow(
      TokenEncryptError,
    );
  });

  it('rejects missing version prefix', () => {
    expect(() => decryptToken('not-a-ciphertext', DEV_FALLBACK_KEY)).toThrow(TokenEncryptError);
  });
});
