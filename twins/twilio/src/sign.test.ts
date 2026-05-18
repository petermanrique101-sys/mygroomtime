import { describe, it, expect } from 'vitest';
import {
  buildSignatureBase,
  signInboundWebhook,
  verifyInboundWebhook,
} from './sign.js';

describe('twilio twin signature', () => {
  it('buildSignatureBase concatenates url + sorted key/value pairs with no separator', () => {
    const base = buildSignatureBase('https://api.example/hook', {
      Body: 'STOP',
      From: '+15551112222',
      To: '+15555550100',
    });
    expect(base).toBe(
      'https://api.example/hookBodySTOPFrom+15551112222To+15555550100',
    );
  });

  it('signInboundWebhook produces a stable base64 string', () => {
    const sig = signInboundWebhook('auth_test', 'https://api.example/hook', {
      Body: 'STOP',
      From: '+15551112222',
    });
    expect(sig.length).toBeGreaterThan(0);
    expect(sig).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('verifyInboundWebhook accepts a freshly signed payload', () => {
    const url = 'https://api.example/hook';
    const params = { Body: 'STOP', From: '+15551112222' };
    const sig = signInboundWebhook('auth_test', url, params);
    expect(verifyInboundWebhook('auth_test', url, params, sig)).toBe(true);
  });

  it('verifyInboundWebhook rejects a different secret', () => {
    const url = 'https://api.example/hook';
    const params = { Body: 'STOP', From: '+15551112222' };
    const sig = signInboundWebhook('auth_test', url, params);
    expect(verifyInboundWebhook('auth_wrong', url, params, sig)).toBe(false);
  });

  it('verifyInboundWebhook rejects a tampered param', () => {
    const url = 'https://api.example/hook';
    const params = { Body: 'STOP', From: '+15551112222' };
    const sig = signInboundWebhook('auth_test', url, params);
    expect(
      verifyInboundWebhook('auth_test', url, { ...params, Body: 'START' }, sig),
    ).toBe(false);
  });

  it('verifyInboundWebhook does not crash on garbage signatures', () => {
    const url = 'https://api.example/hook';
    const params = { Body: 'STOP' };
    expect(verifyInboundWebhook('auth_test', url, params, 'not-a-base64!!!')).toBe(false);
    expect(verifyInboundWebhook('auth_test', url, params, '')).toBe(false);
  });
});
