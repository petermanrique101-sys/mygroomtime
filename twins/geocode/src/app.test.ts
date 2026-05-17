import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app.js';
import { lookupZip } from './zip-table.js';

let app: FastifyInstance;

beforeEach(() => {
  app = createApp();
});

afterEach(async () => {
  await app.close();
});

type GeocodeBody = {
  status: string;
  results: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
    place_id: string;
  }>;
  error_message?: string;
};

async function get(query: Record<string, string>): Promise<{
  statusCode: number;
  headers: Record<string, unknown>;
  body: GeocodeBody;
}> {
  const params = new URLSearchParams(query).toString();
  const res = await app.inject({
    method: 'GET',
    url: `/maps/api/geocode/json?${params}`,
  });
  return {
    statusCode: res.statusCode,
    headers: res.headers as Record<string, unknown>,
    body: res.json() as GeocodeBody,
  };
}

describe('geocode twin server', () => {
  it('returns lat/lng inside the zip envelope for a known Plano address', async () => {
    const res = await get({ address: '1234 Oak St, Plano, TX 75024', key: 'any' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(res.body.results.length).toBe(1);
    const centroid = lookupZip('75024')!;
    const loc = res.body.results[0]!.geometry.location;
    expect(Math.abs(loc.lat - centroid.lat)).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(Math.abs(loc.lng - centroid.lng)).toBeLessThanOrEqual(0.005 + 1e-9);
  });

  it('returns the same coords for the same address (deterministic)', async () => {
    const a = await get({ address: '1234 Oak St, Plano, TX 75024', key: 'any' });
    const b = await get({ address: '1234 Oak St, Plano, TX 75024', key: 'any' });
    expect(a.body.results[0]!.geometry.location).toEqual(b.body.results[0]!.geometry.location);
    expect(a.body.results[0]!.place_id).toBe(b.body.results[0]!.place_id);
  });

  it('returns different coords for different addresses in the same zip', async () => {
    const a = await get({ address: '1234 Oak St, Plano, TX 75024', key: 'any' });
    const b = await get({ address: '5678 Maple Ave, Plano, TX 75024', key: 'any' });
    expect(a.body.results[0]!.geometry.location).not.toEqual(b.body.results[0]!.geometry.location);
  });

  it('unknown zip → ZERO_RESULTS', async () => {
    const res = await get({ address: '1 Nowhere St, Nowheresville, ZZ 99999', key: 'any' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ZERO_RESULTS');
    expect(res.body.results.length).toBe(0);
  });

  it('no zip in address → ZERO_RESULTS', async () => {
    const res = await get({ address: 'Just a street name', key: 'any' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ZERO_RESULTS');
  });

  it('empty address → INVALID_REQUEST', async () => {
    const res = await get({ address: '', key: 'any' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('INVALID_REQUEST');
  });

  it('__ZERO_RESULTS__ sentinel → ZERO_RESULTS', async () => {
    const res = await get({ address: '__ZERO_RESULTS__ 75024', key: 'any' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ZERO_RESULTS');
  });

  it('__OVER_QUERY_LIMIT__ sentinel → HTTP 200 OVER_QUERY_LIMIT', async () => {
    const res = await get({ address: '1 Quota Ln 75024 __OVER_QUERY_LIMIT__', key: 'any' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('OVER_QUERY_LIMIT');
  });

  it('__REQUEST_DENIED__ sentinel → HTTP 200 REQUEST_DENIED', async () => {
    const res = await get({ address: '1 Banned St 75024 __REQUEST_DENIED__', key: 'any' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('REQUEST_DENIED');
  });

  it('__RATE_LIMIT_ME__ sentinel → HTTP 429 with Retry-After', async () => {
    const res = await get({ address: '1 Throttle St 75024 __RATE_LIMIT_ME__', key: 'any' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
    expect(res.body.status).toBe('OVER_QUERY_LIMIT');
  });

  it('formatted_address echoes the zip centroid city/state/zip', async () => {
    const res = await get({ address: '2200 Legacy Dr, Plano, TX 75024', key: 'any' });
    expect(res.body.results[0]!.formatted_address).toContain('Plano, TX 75024');
  });

  it('place_id is a stable twin_place_ token tied to the address hash', async () => {
    const res = await get({ address: '2200 Legacy Dr, Plano, TX 75024', key: 'any' });
    expect(res.body.results[0]!.place_id).toMatch(/^twin_place_[0-9a-f]{8}$/);
  });
});
