import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createGeocodeTwinApp } from '@mygroomtime/twin-geocode';
import { createApp as createGmapsTwinApp } from '@mygroomtime/twin-google-maps';
import { createApp } from '../app.js';
import { createMemorySessionStore } from '../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../adapters/email/index.js';
import { createGeocodeAdapter } from '../adapters/geocode/index.js';
import { createGmapsAdapter, type GmapsAdapter } from '../adapters/gmaps/index.js';
import { makeTestEnv } from '../test-utils/env.js';
import { db } from '@mygroomtime/db';
import {
  cleanupTestTenants,
  createServiceFor,
  signup,
  type TestTenant,
} from '../routes/appointments/test-helpers.js';
import { ensureDefaultVehicle } from '../routes/appointments/find.js';
import {
  computeDayBuffers,
  loadTenantDefaultBufferMin,
} from './buffers.js';

const SLUG_PREFIX = 'buffers-svc-test-';

type ClientPet = { clientId: string; petId: string; addressLat: number; addressLng: number };

async function createClientWithCoords(
  app: FastifyInstance,
  tenant: TestTenant,
  street: string,
  name: string,
): Promise<ClientPet> {
  const res = await app.inject({
    method: 'POST',
    url: '/clients',
    headers: { cookie: tenant.cookie },
    payload: {
      name,
      phone: '+19725550150',
      street,
      city: 'Plano',
      state: 'TX',
      zip: '75024',
      notes: '',
      pets: [{ name: `${name}-pet`, breed: 'Mix', weightLb: 35, coatType: 'short' }],
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`client create failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json() as {
    client: {
      id: string;
      lat: number | null;
      lng: number | null;
      pets: { id: string }[];
    };
  };
  return {
    clientId: body.client.id,
    petId: body.client.pets[0]!.id,
    addressLat: body.client.lat ?? 0,
    addressLng: body.client.lng ?? 0,
  };
}

function plusMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60_000);
}

function tomorrowAt(hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

describe('computeDayBuffers', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let gmapsTwin: FastifyInstance;
  let gmapsAdapter: GmapsAdapter;
  let tenant: TestTenant;
  let serviceId: string;
  let vehicleId: string;

  beforeAll(async () => {
    geocodeTwin = createGeocodeTwinApp({ logger: false });
    await geocodeTwin.listen({ port: 0, host: '127.0.0.1' });
    const geocodePort = (geocodeTwin.server.address() as { port: number }).port;

    gmapsTwin = createGmapsTwinApp({ logger: false });
    await gmapsTwin.listen({ port: 0, host: '127.0.0.1' });
    const gmapsPort = (gmapsTwin.server.address() as { port: number }).port;
    const gmapsTwinUrl = `http://127.0.0.1:${gmapsPort}`;

    gmapsAdapter = createGmapsAdapter({ mode: 'twin', apiKey: '', twinUrl: gmapsTwinUrl });

    app = await createApp({
      logger: false,
      env: makeTestEnv(),
      sessionStore: createMemorySessionStore(),
      emailAdapter: createStdoutEmailAdapter(),
      adapters: {
        geocode: createGeocodeAdapter({
          mode: 'twin',
          apiKey: '',
          twinUrl: `http://127.0.0.1:${geocodePort}`,
        }),
        gmaps: gmapsAdapter,
      },
    });
  });

  afterAll(async () => {
    await cleanupTestTenants(SLUG_PREFIX);
    await app.close();
    await geocodeTwin.close();
    await gmapsTwin.close();
  });

  beforeEach(async () => {
    await cleanupTestTenants(SLUG_PREFIX);
    const ts = Date.now();
    tenant = await signup(app, SLUG_PREFIX, `buf-${ts}`, `buf-${ts}`);
    const svc = await createServiceFor(app, tenant, {
      name: 'Bath',
      durationMin: 60,
      basePriceCents: 5000,
      depositCents: 1000,
      color: '#2563eb',
      active: true,
    });
    serviceId = svc.id;
    const scoped = db.forTenant(tenant.tenantId);
    vehicleId = await ensureDefaultVehicle(scoped);
  });

  async function seedAppt(petId: string, start: Date): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenant.cookie },
      payload: { petId, serviceId, start: start.toISOString() },
    });
    if (res.statusCode !== 201) {
      throw new Error(`appt create failed: ${res.statusCode} ${res.body}`);
    }
    return (res.json() as { appointment: { id: string } }).appointment.id;
  }

  it('3 Plano appointments — buffers between far stops exceed buffers between near stops', async () => {
    const near = await createClientWithCoords(app, tenant, '1 Test St', 'Near');
    const middle = await createClientWithCoords(app, tenant, '2 Test St', 'Middle');
    const far = await createClientWithCoords(app, tenant, '3 Test St', 'Far');

    const scoped = db.forTenant(tenant.tenantId);
    await scoped.client.update({
      where: { id: near.clientId },
      data: { addressLat: 33.0198, addressLng: -96.6989 },
    });
    await scoped.client.update({
      where: { id: middle.clientId },
      data: { addressLat: 33.0207, addressLng: -96.7012 },
    });
    await scoped.client.update({
      where: { id: far.clientId },
      data: { addressLat: 33.1759, addressLng: -96.8053 },
    });

    const t0 = tomorrowAt(9);
    const id1 = await seedAppt(near.petId, t0);
    const id2 = await seedAppt(middle.petId, plusMinutes(t0, 180));
    const id3 = await seedAppt(far.petId, plusMinutes(t0, 360));

    const defaultBufferMin = await loadTenantDefaultBufferMin(tenant.tenantId);
    const map = await computeDayBuffers({
      tenantId: tenant.tenantId,
      date: t0,
      gmaps: gmapsAdapter,
      defaultBufferMin,
      scoped,
    });

    const near2mid = map.get(id2)!;
    const mid2far = map.get(id3)!;
    expect(near2mid.beforeBufferMin).toBeGreaterThan(0);
    expect(mid2far.beforeBufferMin).toBeGreaterThan(0);
    expect(mid2far.beforeBufferMin).toBeGreaterThan(near2mid.beforeBufferMin);

    expect(map.get(id1)!.beforeBufferMin).toBe(defaultBufferMin);
    expect(map.get(id3)!.afterBufferMin).toBe(defaultBufferMin);
    expect(vehicleId).toBeTruthy();
  });

  it('one appointment missing coords — that appointment falls back to defaultBufferMinutes', async () => {
    const verified = await createClientWithCoords(app, tenant, '1 Test St', 'Verified');
    const unverified = await createClientWithCoords(app, tenant, '2 Test St', 'Unverified');

    const scoped = db.forTenant(tenant.tenantId);
    await scoped.client.update({
      where: { id: verified.clientId },
      data: { addressLat: 33.0198, addressLng: -96.6989 },
    });
    await scoped.client.update({
      where: { id: unverified.clientId },
      data: { addressLat: null, addressLng: null, addressVerified: false },
    });

    const t0 = tomorrowAt(9);
    const id1 = await seedAppt(verified.petId, t0);
    const id2 = await seedAppt(unverified.petId, plusMinutes(t0, 180));

    const defaultBufferMin = await loadTenantDefaultBufferMin(tenant.tenantId);
    const map = await computeDayBuffers({
      tenantId: tenant.tenantId,
      date: t0,
      gmaps: gmapsAdapter,
      defaultBufferMin,
      scoped,
    });

    expect(map.get(id1)!.afterBufferMin).toBe(defaultBufferMin);
    expect(map.get(id2)!.beforeBufferMin).toBe(defaultBufferMin);
  });

  it('gmaps adapter throws — every appointment falls back to defaultBufferMinutes, no error propagates', async () => {
    const a = await createClientWithCoords(app, tenant, '1 Test St', 'A');
    const b = await createClientWithCoords(app, tenant, '2 Test St', 'B');

    const scoped = db.forTenant(tenant.tenantId);
    await scoped.client.update({
      where: { id: a.clientId },
      data: { addressLat: 33.0198, addressLng: -96.6989 },
    });
    await scoped.client.update({
      where: { id: b.clientId },
      data: { addressLat: 33.0759, addressLng: -96.8053 },
    });

    const t0 = tomorrowAt(9);
    const id1 = await seedAppt(a.petId, t0);
    const id2 = await seedAppt(b.petId, plusMinutes(t0, 180));

    const throwing: GmapsAdapter = {
      mode: 'twin',
      async distanceMatrix() {
        throw new Error('gmaps down');
      },
    };

    const defaultBufferMin = await loadTenantDefaultBufferMin(tenant.tenantId);
    const map = await computeDayBuffers({
      tenantId: tenant.tenantId,
      date: t0,
      gmaps: throwing,
      defaultBufferMin,
      scoped,
    });

    expect(map.get(id1)!.afterBufferMin).toBe(defaultBufferMin);
    expect(map.get(id2)!.beforeBufferMin).toBe(defaultBufferMin);
  });
});
