import { describe, it, expect } from 'vitest';
import { createGmapsAdapter } from './index.js';
import type { GmapsAdapterEnv } from './types.js';

const baseEnv: Omit<GmapsAdapterEnv, 'mode'> = {
  apiKey: '',
  twinUrl: 'http://localhost:4245',
};

describe('gmaps adapter — wiring', () => {
  it('twin instance reports mode "twin"', () => {
    const adapter = createGmapsAdapter({ ...baseEnv, mode: 'twin' });
    expect(adapter.mode).toBe('twin');
  });

  it('live instance with no apiKey throws an actionable error', async () => {
    const adapter = createGmapsAdapter({ ...baseEnv, mode: 'live' });
    expect(adapter.mode).toBe('live');
    await expect(
      adapter.distanceMatrix({ origins: ['33.02,-96.69'], destinations: ['33.05,-96.72'] }),
    ).rejects.toThrow(/GOOGLE_MAPS_API_KEY/);
  });
});
