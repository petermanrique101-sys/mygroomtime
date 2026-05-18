import { describe, it, expect } from 'vitest';
import { withStopSuffix, verifyWebhookSignature } from './compose.js';
import { signInboundWebhook } from '@mygroomtime/twin-twilio';

describe('twilio adapter — STOP suffix + truncation', () => {
  it('appends " Reply STOP to opt out." when total stays under 160 chars', () => {
    const out = withStopSuffix('Hi there');
    expect(out.final).toBe('Hi there Reply STOP to opt out.');
    expect(out.truncated).toBe(false);
  });

  it('truncates the leading body with … so the STOP suffix always fits', () => {
    const body = 'A'.repeat(200);
    const out = withStopSuffix(body);
    expect(out.truncated).toBe(true);
    expect(out.final.length).toBeLessThanOrEqual(160);
    expect(out.final.endsWith(' Reply STOP to opt out.')).toBe(true);
    expect(out.final).toContain('…');
  });

  it('boundary: a body that just fits with the suffix is not truncated', () => {
    const suffixLen = ' Reply STOP to opt out.'.length;
    const body = 'X'.repeat(160 - suffixLen);
    const out = withStopSuffix(body);
    expect(out.truncated).toBe(false);
    expect(out.final.length).toBe(160);
  });
});

describe('twilio adapter — webhook signature verification', () => {
  it('accepts a signature that the twin would produce', () => {
    const url = 'https://api.example/webhooks/twilio';
    const params = { Body: 'STOP', From: '+15551112222', To: '+15555550100' };
    const sig = signInboundWebhook('auth_shared', url, params);
    expect(verifyWebhookSignature('auth_shared', { url, params, signature: sig })).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const url = 'https://api.example/webhooks/twilio';
    const params = { Body: 'STOP', From: '+15551112222' };
    const sig = signInboundWebhook('auth_shared', url, params);
    expect(
      verifyWebhookSignature('auth_shared', {
        url,
        params: { ...params, Body: 'START' },
        signature: sig,
      }),
    ).toBe(false);
  });

  it('rejects a wrong-secret signature', () => {
    const url = 'https://api.example/webhooks/twilio';
    const params = { Body: 'STOP', From: '+15551112222' };
    const sig = signInboundWebhook('auth_a', url, params);
    expect(verifyWebhookSignature('auth_b', { url, params, signature: sig })).toBe(false);
  });
});
