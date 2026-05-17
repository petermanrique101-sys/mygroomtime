import { describe, it, expect } from 'vitest';
import { createGeocodeAdapter } from './index.js';
import type { GeocodeAdapterEnv } from './types.js';

const baseEnv: Omit<GeocodeAdapterEnv, 'mode'> = {
  apiKey: '',
  twinUrl: 'http://localhost:4246',
};

describe('geocode adapter — wiring', () => {
  it('twin instance reports mode "twin"', () => {
    const adapter = createGeocodeAdapter({ ...baseEnv, mode: 'twin' });
    expect(adapter.mode).toBe('twin');
  });

  it('live instance with no apiKey throws an actionable error', async () => {
    const adapter = createGeocodeAdapter({ ...baseEnv, mode: 'live' });
    expect(adapter.mode).toBe('live');
    await expect(adapter.geocode({ address: '1234 Oak St, Plano, TX 75024' })).rejects.toThrow(
      /GOOGLE_MAPS_API_KEY/,
    );
  });
});
