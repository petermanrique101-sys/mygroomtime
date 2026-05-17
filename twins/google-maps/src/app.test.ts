import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app.js';
import { driveSeconds, haversineMeters } from './haversine.js';

let app: FastifyInstance;

beforeEach(() => {
  app = createApp();
});

afterEach(async () => {
  await app.close();
});

async function get(query: Record<string, string>): Promise<{
  statusCode: number;
  headers: Record<string, unknown>;
  body: Record<string, unknown>;
}> {
  const params = new URLSearchParams(query).toString();
  const res = await app.inject({
    method: 'GET',
    url: `/maps/api/distancematrix/json?${params}`,
  });
  return {
    statusCode: res.statusCode,
    headers: res.headers as Record<string, unknown>,
    body: res.json() as Record<string, unknown>,
  };
}

describe('google-maps twin server', () => {
  it('returns deterministic duration for a known pair (within 1s of formula)', async () => {
    const origin = { lat: 33.02, lng: -96.69 };
    const dest = { lat: 33.05, lng: -96.72 };
    const expectedMeters = haversineMeters(origin, dest);
    const expectedSec = driveSeconds(expectedMeters);

    const res = await get({
      origins: `${origin.lat},${origin.lng}`,
      destinations: `${dest.lat},${dest.lng}`,
      key: 'any',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body['status']).toBe('OK');
    const rows = res.body['rows'] as Array<{
      elements: Array<{ status: string; duration?: { value: number } }>;
    }>;
    const element = rows[0]!.elements[0]!;
    expect(element.status).toBe('OK');
    expect(element.duration!.value).toBeGreaterThanOrEqual(expectedSec - 1);
    expect(element.duration!.value).toBeLessThanOrEqual(expectedSec + 1);
  });

  it('lat=0.0 → element status ZERO_RESULTS, request status OK', async () => {
    const res = await get({
      origins: '0.0,-96.69',
      destinations: '33.05,-96.72',
      key: 'any',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body['status']).toBe('OK');
    const rows = res.body['rows'] as Array<{
      elements: Array<{ status: string }>;
    }>;
    expect(rows[0]!.elements[0]!.status).toBe('ZERO_RESULTS');
  });

  it('lat=-1.0 → HTTP 200 with request status OVER_QUERY_LIMIT', async () => {
    const res = await get({
      origins: '-1.0,-96.69',
      destinations: '33.05,-96.72',
      key: 'any',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body['status']).toBe('OVER_QUERY_LIMIT');
  });

  it('lat=-2.0 → HTTP 429 with Retry-After header', async () => {
    const res = await get({
      origins: '-2.0,-96.69',
      destinations: '33.05,-96.72',
      key: 'any',
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
    expect(res.body['status']).toBe('OVER_QUERY_LIMIT');
  });

  it('missing origins → INVALID_REQUEST', async () => {
    const res = await get({ destinations: '33.05,-96.72', key: 'any' });
    expect(res.statusCode).toBe(200);
    expect(res.body['status']).toBe('INVALID_REQUEST');
  });
});
