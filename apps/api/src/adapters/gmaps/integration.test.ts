import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createTwinApp, driveSeconds, haversineMeters } from '@mygroomtime/twin-google-maps';
import { createGmapsAdapter } from './index.js';

let twin: FastifyInstance;
let twinUrl: string;

beforeAll(async () => {
  twin = createTwinApp({ logger: false });
  const addr = await twin.listen({ port: 0, host: '127.0.0.1' });
  twinUrl = typeof addr === 'string' ? addr : `http://127.0.0.1:${(twin.server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await twin.close();
});

describe('gmaps adapter ↔ twin integration', () => {
  it('twin adapter against a real twin instance agrees with the haversine formula', async () => {
    const adapter = createGmapsAdapter({ mode: 'twin', apiKey: '', twinUrl });
    const origin = { lat: 33.02, lng: -96.69 };
    const dest = { lat: 33.05, lng: -96.72 };
    const expected = driveSeconds(haversineMeters(origin, dest));

    const out = await adapter.distanceMatrix({
      origins: [`${origin.lat},${origin.lng}`],
      destinations: [`${dest.lat},${dest.lng}`],
    });

    expect(out.rows.length).toBe(1);
    const el = out.rows[0]![0]!;
    expect(el.status).toBe('OK');
    expect(el.durationSec).toBeGreaterThanOrEqual(expected - 1);
    expect(el.durationSec).toBeLessThanOrEqual(expected + 1);
    expect(el.distanceM).toBeGreaterThan(0);
  });

  it('twin adapter surfaces ZERO_RESULTS as an element status', async () => {
    const adapter = createGmapsAdapter({ mode: 'twin', apiKey: '', twinUrl });
    const out = await adapter.distanceMatrix({
      origins: ['0.0,-96.69'],
      destinations: ['33.05,-96.72'],
    });
    expect(out.rows[0]![0]!.status).toBe('ZERO_RESULTS');
  });

  it('twin adapter surfaces OVER_QUERY_LIMIT (request-level error) as a thrown GmapsRequestError', async () => {
    const adapter = createGmapsAdapter({ mode: 'twin', apiKey: '', twinUrl });
    await expect(
      adapter.distanceMatrix({
        origins: ['-1.0,-96.69'],
        destinations: ['33.05,-96.72'],
      }),
    ).rejects.toMatchObject({ name: 'GmapsRequestError', status: 'OVER_QUERY_LIMIT' });
  });
});

const liveKey = process.env.GOOGLE_MAPS_API_KEY ?? '';
const itLive = liveKey ? it : it.skip;

describe('gmaps live adapter — real Google (only with GOOGLE_MAPS_API_KEY)', () => {
  itLive('returns a sensible duration for a Plano TX lat/lng pair', async () => {
    const adapter = createGmapsAdapter({ mode: 'live', apiKey: liveKey, twinUrl: '' });
    const out = await adapter.distanceMatrix({
      origins: ['33.0198,-96.6989'],
      destinations: ['33.0759,-96.8053'],
    });
    expect(out.rows.length).toBe(1);
    const el = out.rows[0]![0]!;
    expect(el.status).toBe('OK');
    expect(el.durationSec).toBeGreaterThan(0);
    expect(el.distanceM).toBeGreaterThan(0);
  }, 15_000);
});
