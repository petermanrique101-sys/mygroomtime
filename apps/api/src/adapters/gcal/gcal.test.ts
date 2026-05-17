import { describe, it, expect } from 'vitest';
import { createGcalAdapter } from './index.js';
import type { GcalAdapterEnv } from './types.js';

const baseEnv: Omit<GcalAdapterEnv, 'mode'> = {
  oauthClientId: 'test-client-id',
  oauthClientSecret: 'test-client-secret',
  twinUrl: 'http://localhost:4244',
};

describe('gcal adapter — scaffold', () => {
  it('twin instance throws "not implemented: gcal.twin.<method>"', async () => {
    const adapter = createGcalAdapter({ ...baseEnv, mode: 'twin' });
    expect(adapter.mode).toBe('twin');
    await expect(adapter.listCalendars({ accessToken: 'tok' })).rejects.toThrow(
      'not implemented: gcal.twin.listCalendars',
    );
  });

  it('live instance throws "not implemented: gcal.live.<method>"', async () => {
    const adapter = createGcalAdapter({ ...baseEnv, mode: 'live' });
    expect(adapter.mode).toBe('live');
    await expect(adapter.listCalendars({ accessToken: 'tok' })).rejects.toThrow(
      'not implemented: gcal.live.listCalendars',
    );
  });
});
