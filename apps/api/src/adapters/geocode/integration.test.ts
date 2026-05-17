import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createTwinApp, lookupZip } from '@mygroomtime/twin-geocode';
import { createGeocodeAdapter } from './index.js';

let twin: FastifyInstance;
let twinUrl: string;

beforeAll(async () => {
  twin = createTwinApp({ logger: false });
  const addr = await twin.listen({ port: 0, host: '127.0.0.1' });
  twinUrl =
    typeof addr === 'string'
      ? addr
      : `http://127.0.0.1:${(twin.server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await twin.close();
});

describe('geocode adapter ↔ twin integration', () => {
  it('returns deterministic Plano-envelope coords for a known address', async () => {
    const adapter = createGeocodeAdapter({ mode: 'twin', apiKey: '', twinUrl });
    const address = '1234 Oak St, Plano, TX 75024';

    const a = await adapter.geocode({ address });
    const b = await adapter.geocode({ address });

    expect(a).toEqual(b);
    const centroid = lookupZip('75024')!;
    expect(Math.abs(a.lat - centroid.lat)).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(Math.abs(a.lng - centroid.lng)).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(a.formattedAddress).toContain('Plano, TX 75024');
    expect(a.placeId).toMatch(/^twin_place_/);
  });

  it('surfaces ZERO_RESULTS as a thrown GeocodeRequestError', async () => {
    const adapter = createGeocodeAdapter({ mode: 'twin', apiKey: '', twinUrl });
    await expect(
      adapter.geocode({ address: '__ZERO_RESULTS__, Plano, TX 75024' }),
    ).rejects.toMatchObject({ name: 'GeocodeRequestError', status: 'ZERO_RESULTS' });
  });

  it('surfaces REQUEST_DENIED as a thrown GeocodeRequestError', async () => {
    const adapter = createGeocodeAdapter({ mode: 'twin', apiKey: '', twinUrl });
    await expect(
      adapter.geocode({ address: '1 X St 75024 __REQUEST_DENIED__' }),
    ).rejects.toMatchObject({ name: 'GeocodeRequestError', status: 'REQUEST_DENIED' });
  });
});

const liveKey = process.env.GOOGLE_MAPS_API_KEY ?? '';
const itLive = liveKey ? it : it.skip;

describe('geocode live adapter — real Google (only with GOOGLE_MAPS_API_KEY)', () => {
  itLive('returns a sensible lat/lng for a real Plano address', async () => {
    const adapter = createGeocodeAdapter({ mode: 'live', apiKey: liveKey, twinUrl: '' });
    const out = await adapter.geocode({ address: '6101 Windhaven Pkwy, Plano, TX 75093' });
    expect(out.lat).toBeGreaterThan(32);
    expect(out.lat).toBeLessThan(34);
    expect(out.lng).toBeLessThan(-95);
    expect(out.lng).toBeGreaterThan(-98);
    expect(out.placeId.length).toBeGreaterThan(0);
  }, 15_000);
});
