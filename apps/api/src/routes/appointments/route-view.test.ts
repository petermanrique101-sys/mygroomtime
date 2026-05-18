import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createGeocodeTwinApp } from '@mygroomtime/twin-geocode';
import { createApp as createGmapsTwinApp } from '@mygroomtime/twin-google-maps';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import { createGeocodeAdapter } from '../../adapters/geocode/index.js';
import { createGmapsAdapter } from '../../adapters/gmaps/index.js';
import { makeTestEnv } from '../../test-utils/env.js';
import { db, PlanTier } from '@mygroomtime/db';
import {
  cleanupTestTenants,
  createServiceFor,
  signup,
  type TestTenant,
} from './test-helpers.js';

const SLUG_PREFIX = 'route-view-test-';

async function seedClient(
  app: FastifyInstance,
  tenant: TestTenant,
  name: string,
  lat: number,
  lng: number,
): Promise<{ clientId: string; petId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/clients',
    headers: { cookie: tenant.cookie },
    payload: {
      name,
      phone: '+19725550150',
      street: `${name} St`,
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
  const body = res.json() as { client: { id: string; pets: { id: string }[] } };
  const scoped = db.forTenant(tenant.tenantId);
  await scoped.client.update({
    where: { id: body.client.id },
    data: { addressLat: lat, addressLng: lng, addressVerified: true },
  });
  return { clientId: body.client.id, petId: body.client.pets[0]!.id };
}

function tomorrowAt(hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function plusMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60_000);
}

describe('GET /appointments/today/route', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let gmapsTwin: FastifyInstance;
  let tenant: TestTenant;
  let serviceId: string;

  beforeAll(async () => {
    geocodeTwin = createGeocodeTwinApp({ logger: false });
    await geocodeTwin.listen({ port: 0, host: '127.0.0.1' });
    const geocodePort = (geocodeTwin.server.address() as { port: number }).port;

    gmapsTwin = createGmapsTwinApp({ logger: false });
    await gmapsTwin.listen({ port: 0, host: '127.0.0.1' });
    const gmapsPort = (gmapsTwin.server.address() as { port: number }).port;

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
        gmaps: createGmapsAdapter({
          mode: 'twin',
          apiKey: '',
          twinUrl: `http://127.0.0.1:${gmapsPort}`,
        }),
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
    const ts = Date.now() + Math.floor(Math.random() * 1000);
    tenant = await signup(app, SLUG_PREFIX, `rv-${ts}`, `rv-${ts}`);
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: {
        plan: PlanTier.pro,
        depotLat: 33.0198,
        depotLng: -96.6989,
      },
    });
    const svc = await createServiceFor(app, tenant, {
      name: 'Bath',
      durationMin: 60,
      basePriceCents: 5000,
      depositCents: 1000,
      color: '#2563eb',
      active: true,
    });
    serviceId = svc.id;
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

  it('Pro tenant gets 200 with stops + drive times in minutes', async () => {
    const a = await seedClient(app, tenant, 'A', 33.0205, -96.7000);
    const b = await seedClient(app, tenant, 'B', 33.0260, -96.7150);
    const t0 = tomorrowAt(9);
    await seedAppt(a.petId, t0);
    await seedAppt(b.petId, plusMinutes(t0, 180));

    const res = await app.inject({
      method: 'GET',
      url: `/appointments/today/route?date=${encodeURIComponent(t0.toISOString())}`,
      headers: { cookie: tenant.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      depotUsed: boolean;
      totalDriveMin: number;
      stops: Array<{ driveFromPrevMin: number; pet: { name: string } }>;
      warnings: string[];
    };
    expect(body.depotUsed).toBe(true);
    expect(body.stops).toHaveLength(2);
    for (const s of body.stops) {
      expect(Number.isInteger(s.driveFromPrevMin)).toBe(true);
    }
    expect(body.warnings).toEqual([]);
  });

  it('Starter tenant gets 403 with reason tier_gated', async () => {
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: { plan: PlanTier.starter },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/appointments/today/route',
      headers: { cookie: tenant.cookie },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { reason: string };
    expect(body.reason).toBe('tier_gated');
  });

  it('0-appointment day returns empty stops cleanly', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/appointments/today/route?date=${encodeURIComponent(tomorrowAt(9).toISOString())}`,
      headers: { cookie: tenant.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { stops: unknown[]; totalDriveMin: number };
    expect(body.stops).toEqual([]);
    expect(body.totalDriveMin).toBe(0);
  });

  it('no depot configured — warning surfaced', async () => {
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: { depotLat: null, depotLng: null },
    });
    const a = await seedClient(app, tenant, 'A', 33.0205, -96.7000);
    const t0 = tomorrowAt(9);
    await seedAppt(a.petId, t0);

    const res = await app.inject({
      method: 'GET',
      url: `/appointments/today/route?date=${encodeURIComponent(t0.toISOString())}`,
      headers: { cookie: tenant.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { depotUsed: boolean; warnings: string[] };
    expect(body.depotUsed).toBe(false);
    expect(body.warnings.some((w) => w.toLowerCase().includes('depot'))).toBe(true);
  });
});

describe('POST /appointments/today/route/apply', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let gmapsTwin: FastifyInstance;
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
        gmaps: createGmapsAdapter({
          mode: 'twin',
          apiKey: '',
          twinUrl: `http://127.0.0.1:${gmapsPort}`,
        }),
      },
    });
  });

  afterAll(async () => {
    await cleanupTestTenants('route-apply-test-');
    await app.close();
    await geocodeTwin.close();
    await gmapsTwin.close();
  });

  beforeEach(async () => {
    await cleanupTestTenants('route-apply-test-');
    const ts = Date.now() + Math.floor(Math.random() * 1000);
    tenant = await signup(app, 'route-apply-test-', `ra-${ts}`, `ra-${ts}`);
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: { plan: PlanTier.pro, depotLat: 33.0198, depotLng: -96.6989 },
    });
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
    const v = await scoped.vehicle.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!v) {
      vehicleId = (await scoped.vehicle.create({ data: { name: 'Van 1' } })).id;
    } else {
      vehicleId = v.id;
    }
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

  it('Idempotent: all startSuggested == scheduledStart → applied=0, unchanged=N', async () => {
    const a = await seedClient(app, tenant, 'A', 33.0205, -96.7000);
    const b = await seedClient(app, tenant, 'B', 33.0260, -96.7150);
    const t0 = tomorrowAt(9);
    const id1 = await seedAppt(a.petId, t0);
    const id2 = await seedAppt(b.petId, plusMinutes(t0, 120));

    const res = await app.inject({
      method: 'POST',
      url: '/appointments/today/route/apply',
      headers: { cookie: tenant.cookie },
      payload: {
        date: t0.toISOString(),
        vehicleId,
        stops: [
          { appointmentId: id1, startSuggested: t0.toISOString() },
          { appointmentId: id2, startSuggested: plusMinutes(t0, 120).toISOString() },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ applied: 0, unchanged: 2 });
  });

  it('Applies non-overlapping shifts — applied=N, unchanged=0', async () => {
    const a = await seedClient(app, tenant, 'A', 33.0205, -96.7000);
    const b = await seedClient(app, tenant, 'B', 33.0260, -96.7150);
    const t0 = tomorrowAt(9);
    const id1 = await seedAppt(a.petId, t0);
    const id2 = await seedAppt(b.petId, plusMinutes(t0, 300));

    // Shift id2 closer (still no overlap with id1's 60min duration)
    const newStart = plusMinutes(t0, 90);
    const res = await app.inject({
      method: 'POST',
      url: '/appointments/today/route/apply',
      headers: { cookie: tenant.cookie },
      payload: {
        date: t0.toISOString(),
        vehicleId,
        stops: [
          { appointmentId: id1, startSuggested: t0.toISOString() },
          { appointmentId: id2, startSuggested: newStart.toISOString() },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ applied: 1, unchanged: 1 });

    const scoped = db.forTenant(tenant.tenantId);
    const row = await scoped.appointment.findFirst({ where: { id: id2 } });
    expect(row?.scheduledStart.getTime()).toBe(newStart.getTime());
  });

  it('Concurrent modification → 409 with reason concurrent_modification', async () => {
    const a = await seedClient(app, tenant, 'A', 33.0205, -96.7000);
    const b = await seedClient(app, tenant, 'B', 33.0260, -96.7150);
    const t0 = tomorrowAt(9);
    const id1 = await seedAppt(a.petId, t0);
    const id2 = await seedAppt(b.petId, plusMinutes(t0, 300));

    // Simulate a competing booking that fills the slot we're trying to move id2 into
    const c = await seedClient(app, tenant, 'C', 33.0270, -96.7160);
    await seedAppt(c.petId, plusMinutes(t0, 90));

    // Now apply tries to put id2 at minute 90 — overlap with C
    const res = await app.inject({
      method: 'POST',
      url: '/appointments/today/route/apply',
      headers: { cookie: tenant.cookie },
      payload: {
        date: t0.toISOString(),
        vehicleId,
        stops: [
          { appointmentId: id1, startSuggested: t0.toISOString() },
          {
            appointmentId: id2,
            startSuggested: plusMinutes(t0, 90).toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: 'route_apply_conflict',
      reason: 'concurrent_modification',
    });

    // Confirm no shifts persisted
    const scoped = db.forTenant(tenant.tenantId);
    const row2 = await scoped.appointment.findFirst({ where: { id: id2 } });
    expect(row2?.scheduledStart.getTime()).toBe(plusMinutes(t0, 300).getTime());
  });
});
