import { describe, it, expect } from 'vitest';
import { createGcalAdapter } from './index.js';
import type { GcalAdapterEnv } from './types.js';

// why: scaffold-era "throws not implemented" assertions were removed in chunk 20 when
// the methods became real. We keep a small surface-shape test here so the index export
// stays under guard — full behavior is exercised in gcal.integration.test.ts.

const baseEnv: Omit<GcalAdapterEnv, 'mode'> = {
  oauthClientId: 'test-client-id',
  oauthClientSecret: 'test-client-secret',
  twinUrl: 'http://localhost:4244',
};

describe('gcal adapter — index surface', () => {
  it('twin mode reports mode: twin and exposes every method', () => {
    const adapter = createGcalAdapter({ ...baseEnv, mode: 'twin' });
    expect(adapter.mode).toBe('twin');
    expect(typeof adapter.exchangeOAuthCode).toBe('function');
    expect(typeof adapter.refreshAccessToken).toBe('function');
    expect(typeof adapter.revokeRefreshToken).toBe('function');
    expect(typeof adapter.listCalendars).toBe('function');
    expect(typeof adapter.insertEvent).toBe('function');
    expect(typeof adapter.updateEvent).toBe('function');
    expect(typeof adapter.deleteEvent).toBe('function');
    expect(typeof adapter.listEvents).toBe('function');
    expect(typeof adapter.watchChannel).toBe('function');
    expect(typeof adapter.stopChannel).toBe('function');
  });

  it('live mode reports mode: live', () => {
    const adapter = createGcalAdapter({ ...baseEnv, mode: 'live' });
    expect(adapter.mode).toBe('live');
  });
});
