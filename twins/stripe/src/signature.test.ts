import { describe, it, expect } from 'vitest';
import { signPayload, parseSignatureHeader, verifySignature } from './signature.js';

describe('stripe twin signature', () => {
  it('signPayload produces a parseable t=,v1= header', () => {
    const header = signPayload('whsec_x', 1700000000, '{"a":1}');
    const parsed = parseSignatureHeader(header);
    expect(parsed?.timestampSec).toBe(1700000000);
    expect(parsed?.v1Signatures.length).toBe(1);
    expect(parsed?.v1Signatures[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifySignature accepts a freshly signed payload', () => {
    const ts = Math.floor(Date.now() / 1000);
    const header = signPayload('whsec_x', ts, '{"a":1}');
    expect(verifySignature('whsec_x', header, '{"a":1}')).toBe(true);
  });

  it('verifySignature rejects a wrong secret', () => {
    const ts = Math.floor(Date.now() / 1000);
    const header = signPayload('whsec_x', ts, '{"a":1}');
    expect(verifySignature('whsec_other', header, '{"a":1}')).toBe(false);
  });

  it('verifySignature rejects a tampered payload', () => {
    const ts = Math.floor(Date.now() / 1000);
    const header = signPayload('whsec_x', ts, '{"a":1}');
    expect(verifySignature('whsec_x', header, '{"a":2}')).toBe(false);
  });

  it('verifySignature rejects an old timestamp beyond tolerance', () => {
    const ts = Math.floor(Date.now() / 1000) - 600;
    const header = signPayload('whsec_x', ts, '{"a":1}');
    expect(verifySignature('whsec_x', header, '{"a":1}', 60)).toBe(false);
  });

  it('parseSignatureHeader returns null on malformed input', () => {
    expect(parseSignatureHeader('garbage')).toBeNull();
    expect(parseSignatureHeader('t=abc,v1=def')).toBeNull();
  });
});
