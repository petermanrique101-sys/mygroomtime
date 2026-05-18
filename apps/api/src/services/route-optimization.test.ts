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
import { optimizeRoute } from './route-optimization.js';

const SLUG_PREFIX = 'route-opt-test-';

type SeededClient = { clientId: string; petId: string };

async function createClientWithCoords(
  app: FastifyInstance,
  tenant: TestTenant,
  street: string,
  name: string,
  lat: number,
  lng: number,
): Promise<SeededClient> {
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
  const body = res.json() as { client: { id: string; pets: { id: string }[] } };
  const scoped = db.forTenant(tenant.tenantId);
  await scoped.client.update({
    where: { id: body.client.id },
    data: { addressLat: lat, addressLng: lng, addressVerified: true },
  });
  return { clientId: body.client.id, petId: body.client.pets[0]!.id };
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

describe('optimizeRoute', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let gmapsTwin: FastifyInstance;
  let gmapsAdapter: GmapsAdapter;
  let tenant: TestTenant;
  let serviceId: string;
  let vehicleId: string;
  const depot = { lat: 33.0198, lng: -96.6989 };

  beforeAll(async () => {
    geocodeTwin = createGeocodeTwinApp({ logger: false });
    await geocodeTwin.listen({ port: 0, host: '127.0.0.1' });
    const geocodePort = (geocodeTwin.server.address() as { port: number }).port;

    gmapsTwin = createGmapsTwinApp({ logger: false });
    await gmapsTwin.listen({ port: 0, host: '127.0.0.1' });
    const gmapsPort = (gmapsTwin.server.address() as { port: number }).port;
    gmapsAdapter = createGmapsAdapter({
      mode: 'twin',
      apiKey: '',
      twinUrl: `http://127.0.0.1:${gmapsPort}`,
    });

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
    tenant = await signup(app, SLUG_PREFIX, `opt-${ts}`, `opt-${ts}`);
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

  async function seedAppt(petId: string, start: Date, locked = false): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenant.cookie },
      payload: { petId, serviceId, start: start.toISOString() },
    });
    if (res.statusCode !== 201) {
      throw new Error(`appt create failed: ${res.statusCode} ${res.body}`);
    }
    const id = (res.json() as { appointment: { id: string } }).appointment.id;
    if (locked) {
      const scoped = db.forTenant(tenant.tenantId);
      await scoped.appointment.update({ where: { id }, data: { timeLocked: true } });
    }
    return id;
  }

  it('0 appointments — empty stops, 0 drive, no warnings', async () => {
    const out = await optimizeRoute({
      tenantId: tenant.tenantId,
      vehicleId,
      date: tomorrowAt(9),
      gmaps: gmapsAdapter,
      depotLatLng: depot,
    });
    expect(out.orderedStops).toHaveLength(0);
    expect(out.totalDriveMin).toBe(0);
    expect(out.warnings).toEqual([]);
    expect(out.depotUsed).toBe(false);
  });

  it('3 unlocked appointments — 3 stops in greedy order, drive time summed', async () => {
    // why: depot at A, near at B, far at C — far gets booked first chronologically,
    // but greedy from depot should pick B (closer) before C.
    const a = await createClientWithCoords(app, tenant, '1 A', 'A', 33.0205, -96.7000);
    const b = await createClientWithCoords(app, tenant, '2 B', 'B', 33.0250, -96.7100);
    const c = await createClientWithCoords(app, tenant, '3 C', 'C', 33.1759, -96.8053);

    const t0 = tomorrowAt(9);
    await seedAppt(c.petId, t0);
    await seedAppt(a.petId, plusMinutes(t0, 180));
    await seedAppt(b.petId, plusMinutes(t0, 360));

    const out = await optimizeRoute({
      tenantId: tenant.tenantId,
      vehicleId,
      date: t0,
      gmaps: gmapsAdapter,
      depotLatLng: depot,
    });

    expect(out.orderedStops).toHaveLength(3);
    expect(out.depotUsed).toBe(true);
    expect(out.warnings).toEqual([]);
    expect(out.totalDriveMin).toBeGreaterThan(0);
    for (const s of out.orderedStops) {
      expect(s.driveFromPrevMin).toBe(Math.round(s.driveFromPrevSec / 60));
      expect(s.durationMin).toBe(60);
    }
    // first stop should be the closest to depot
    expect(out.orderedStops[0]!.driveFromPrevSec).toBeLessThanOrEqual(
      out.orderedStops[2]!.driveFromPrevSec,
    );
  });

  it('1 locked + 2 unlocked — locked stays in scheduled slot, unlocked order around it', async () => {
    const a = await createClientWithCoords(app, tenant, '1 A', 'A', 33.0205, -96.7000);
    const b = await createClientWithCoords(app, tenant, '2 B', 'B', 33.0260, -96.7150);
    const c = await createClientWithCoords(app, tenant, '3 C', 'C', 33.0300, -96.7250);

    const t0 = tomorrowAt(9);
    const lockedStart = plusMinutes(t0, 180);
    const lockedId = await seedAppt(b.petId, lockedStart, true);
    await seedAppt(a.petId, t0);
    await seedAppt(c.petId, plusMinutes(t0, 360));

    const out = await optimizeRoute({
      tenantId: tenant.tenantId,
      vehicleId,
      date: t0,
      gmaps: gmapsAdapter,
      depotLatLng: depot,
    });

    expect(out.orderedStops).toHaveLength(3);
    const lockedStop = out.orderedStops.find((s) => s.appointmentId === lockedId)!;
    expect(lockedStop.startSuggested.getTime()).toBe(lockedStart.getTime());
  });

  it('no depot configured — first appointment used as anchor, warning surfaced', async () => {
    const a = await createClientWithCoords(app, tenant, '1 A', 'A', 33.0205, -96.7000);
    const b = await createClientWithCoords(app, tenant, '2 B', 'B', 33.0260, -96.7150);
    const t0 = tomorrowAt(9);
    await seedAppt(a.petId, t0);
    await seedAppt(b.petId, plusMinutes(t0, 180));

    const out = await optimizeRoute({
      tenantId: tenant.tenantId,
      vehicleId,
      date: t0,
      gmaps: gmapsAdapter,
      // no depotLatLng
    });

    expect(out.orderedStops).toHaveLength(2);
    expect(out.depotUsed).toBe(false);
    expect(out.warnings.some((w) => w.toLowerCase().includes('depot'))).toBe(true);
    expect(out.orderedStops[0]!.driveFromPrevSec).toBe(0);
  });

  it('gmaps adapter error — service throws', async () => {
    const a = await createClientWithCoords(app, tenant, '1 A', 'A', 33.0205, -96.7000);
    const t0 = tomorrowAt(9);
    await seedAppt(a.petId, t0);

    const throwing: GmapsAdapter = {
      mode: 'twin',
      async distanceMatrix() {
        throw new Error('gmaps down');
      },
    };

    await expect(
      optimizeRoute({
        tenantId: tenant.tenantId,
        vehicleId,
        date: t0,
        gmaps: throwing,
        depotLatLng: depot,
      }),
    ).rejects.toThrow(/gmaps down/);
  });
});
